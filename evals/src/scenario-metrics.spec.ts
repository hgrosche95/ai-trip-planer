import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateScenario, planMetrics } from './plan-metrics.js';
import { parseSseBlock } from './run-client.js';
import { failedThresholds, percentile, scenarioThresholds, summarize } from './scenario-summary.js';
import type { RunCapture, RunEvent, Scenario, ScenarioResult } from './scenario-types.js';

// Echte Orchestrator-Läufe (Fake-LLM, Recherche-Fixtures der API-Tests),
// aufgezeichnet als Ereignisliste wie sie über SSE ankommt
function fixture(name: string): RunCapture {
  const events = JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf-8')) as RunEvent[];
  return { message: name, events, wallMs: 1000 };
}

const scenario = (expect: Scenario['expect'], messages = ['m']): Scenario => ({
  id: 's',
  title: 's',
  messages,
  expect,
});

let seq = 0;
const event = <T extends RunEvent['type']>(type: T, data: Extract<RunEvent, { type: T }>['data']) =>
  ({ type, seq: ++seq, elapsedMs: seq, data }) as RunEvent;

test('parseSseBlock: data-Zeile ist das Ereignis, Kommentare und leere Blöcke nicht', () => {
  const data = { type: 'run.started', seq: 1, elapsedMs: 0, data: { runId: 'r', mode: 'multi' } };
  assert.deepEqual(parseSseBlock(`event: run.started\nid: 1\ndata: ${JSON.stringify(data)}`), data);
  assert.equal(parseSseBlock(': ping'), null);
  assert.equal(parseSseBlock(''), null);
});

test('Regenlauf: Nachbesserung wirkt, der fertige Plan hat keine harten Fehler', () => {
  const run = fixture('run-lissabon-regen');
  const metrics = planMetrics(run);

  assert.equal(metrics.days, 3);
  assert.equal(metrics.hardErrors, 0);
  // Tag 2 regnet (6 mm), nach der Nachbesserung ohne Programm draußen
  assert.equal(metrics.rainDays, 1);
  assert.equal(metrics.rainDaysDry, 1);
  assert.equal(metrics.critiqueRounds, 2);
  assert.equal(metrics.firstErrors, 2);
  assert.equal(metrics.lastErrors, 0);
  assert.equal(metrics.geoValid, metrics.geoChecked);
  assert.equal(metrics.complete, true);

  // Die Budget-Schätzung der Fixtures liegt über 800 €: "feasible" fällt durch
  const { checks } = evaluateScenario(scenario({ days: 3, budget: 'feasible' }), [run]);
  assert.deepEqual(
    checks.filter((c) => !c.passed).map((c) => c.name),
    ['Budget eingehalten'],
  );
  assert.deepEqual(
    evaluateScenario(scenario({ budget: 'impossible' }), [run]).checks.filter((c) => !c.passed),
    [],
  );
});

test('Vorlieben und Recherche-Aufgaben werden geprüft', () => {
  const run = fixture('run-lissabon-vegetarisch');
  const { checks, metrics } = evaluateScenario(
    scenario({ days: 3, preferences: ['vegetarisch'], research: ['research:holidays', 'research:currency'] }),
    [run],
  );
  assert.deepEqual(
    checks.filter((c) => !c.passed).map((c) => c.name),
    ['Recherche research:currency'],
  );
  assert.equal(metrics.llmCalls, 5);
  assert.ok(metrics.tokens > 0);
});

test('Rückfrage: kein Entwurf und keine Recherche; ein Plan wäre falsch', () => {
  const ask: RunCapture = {
    message: 'Ich will verreisen',
    wallMs: 800,
    events: [
      event('run.started', { runId: 'r', mode: 'multi' }),
      event('agent.started', { stepId: 'a', agent: 'planner', task: 'triage' }),
      event('message.completed', { text: 'Wohin soll es gehen?' }),
      event('run.finished', {
        totals: { llmCalls: 1, toolCalls: 0, inputTokens: 700, outputTokens: 60, costUsd: 0.0001, durationMs: 800 },
      }),
    ],
  };
  const good = evaluateScenario(scenario({ clarification: true }), [ask]);
  assert.ok(good.checks.every((c) => c.passed));
  assert.equal(good.metrics.tokens, 760);

  const planned = evaluateScenario(scenario({ clarification: true }), [fixture('run-lissabon-regen')]);
  assert.deepEqual(
    planned.checks.filter((c) => !c.passed).map((c) => c.name),
    ['Rückfrage statt Plan', 'keine Recherche'],
  );
});

test('Folgenachricht: nur der genannte Tag darf sich ändern', () => {
  const first = fixture('run-lissabon-regen');
  const draftEvent = first.events.find((e) => e.type === 'itinerary.draft')!;
  const draft = draftEvent.data as Extract<RunEvent, { type: 'itinerary.draft' }>['data'];
  const revised = (days: number[]): RunCapture => ({
    message: 'Tag 2 bitte entspannter',
    wallMs: 500,
    events: [
      ...first.events.filter((e) => e.type !== 'itinerary.draft'),
      event('itinerary.draft', {
        ...draft,
        revision: 2,
        itinerary: {
          ...draft.itinerary,
          stops: draft.itinerary.stops.map((stop) =>
            days.includes(stop.dayNumber) && stop.order === 1 ? { ...stop, title: 'Neu' } : stop,
          ),
        },
      }),
    ],
  });
  const only2 = evaluateScenario(scenario({ revisedDays: [2] }, ['a', 'b']), [first, revised([2])]);
  assert.ok(only2.checks.find((c) => c.name === 'nur Tag 2 geändert')!.passed);
  assert.ok(only2.checks.find((c) => c.name === 'Überarbeitung als neue Fassung')!.passed);
  const alsoDay1 = evaluateScenario(scenario({ revisedDays: [2] }, ['a', 'b']), [first, revised([1, 2])]);
  assert.equal(alsoDay1.checks.find((c) => c.name === 'nur Tag 2 geändert')!.passed, false);
});

test('run.error: Szenario abgebrochen, zählt als Befund', () => {
  const broken: RunCapture = {
    message: 'm',
    wallMs: 100,
    events: [
      event('run.started', { runId: 'r', mode: 'multi' }),
      event('run.error', { code: 'rate_limited', message: 'zu viele Anfragen' }),
    ],
  };
  const result = evaluateScenario(scenario({ days: 3 }), [broken]);
  assert.equal(result.error, 'rate_limited');
  assert.equal(result.checks[0].passed, false);
});

test('Zusammenfassung: Quoten, Perzentile und verfehlte Schwellen', () => {
  const base = (id: string, patch: Partial<ScenarioResult>): ScenarioResult => ({
    id,
    title: id,
    passed: true,
    checks: [],
    metrics: { llmCalls: 3, tokens: 6000, costUsd: 0.001, durationMs: 12_000, throttledMs: 0 },
    judge: {},
    replyExcerpt: '',
    ...patch,
  });
  const plan = (id: string, hardErrors: number, extra: object = {}) =>
    base(id, {
      metrics: {
        llmCalls: 4,
        tokens: 7000,
        costUsd: 0.002,
        durationMs: 15_000,
        throttledMs: 3000,
        days: 3,
        hardErrors,
        rainDays: 1,
        rainDaysDry: hardErrors === 0 ? 1 : 0,
        geoChecked: 5,
        geoValid: 5,
        complete: true,
        critiqueRounds: 2,
        firstErrors: 1,
        lastErrors: hardErrors,
        ...extra,
      },
      checks: [{ name: 'Budget eingehalten', passed: hardErrors === 0 }],
      judge: { plan: { structure: 4, preferences: 4, realism: 4, sources: 4, mean: 4 } },
    });
  const results = [
    plan('a', 0),
    plan('b', 1),
    base('ask', { checks: [{ name: 'Rückfrage statt Plan', passed: true }, { name: 'keine Recherche', passed: true }] }),
    base('broken', { passed: false, error: 'rate_limited' }),
  ];

  const summary = summarize(results);
  assert.equal(summary.scenarios, 4);
  assert.equal(summary.budgetCompliance, 0.5);
  assert.equal(summary.hardErrorsAvg, 0.5);
  assert.equal(summary.hardErrorsMax, 1);
  assert.equal(summary.weatherAwareness, 0.5);
  assert.equal(summary.clarificationAccuracy, 1);
  assert.equal(summary.revisionEffectiveness, 0.5);
  assert.equal(summary.judgeMean, 4);
  assert.equal(summary.honesty, null);
  assert.equal(summary.latencyP95NoWaitMs, 12_000);

  const failed = failedThresholds(summary, results, scenarioThresholds());
  assert.deepEqual(failed, [
    'Budget-Einhaltung 0.5 < 0.9',
    'Regelverstöße Ø 0.5 > 0.1',
    'Wetterbewusstsein 0.5 < 0.8',
    'Revisionswirksamkeit 0.5 < 0.8',
    'abgebrochen: broken',
  ]);
});

test('percentile: nächster Rang, leer = 0', () => {
  assert.equal(percentile([5, 1, 3, 2, 4], 50), 3);
  assert.equal(percentile([5, 1, 3, 2, 4], 95), 5);
  assert.equal(percentile([], 95), 0);
});

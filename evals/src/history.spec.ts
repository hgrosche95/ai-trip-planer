import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badgeFor, emptyHistory, entriesFromReports, mergeHistory, type AnyReport } from './history.js';
import type { EvalSummary } from './report.js';
import type { ScenarioReport } from './scenario-report.js';
import { scenarioThresholds, summarize } from './scenario-summary.js';
import type { ScenarioResult } from './scenario-types.js';

function knowledge(overrides: Partial<EvalSummary> = {}): AnyReport {
  return {
    kind: 'knowledge',
    report: {
      timestamp: '2026-10-10T03:05:00.000Z',
      gitSha: 'abc1234',
      runId: '42',
      runUrl: 'https://github.com/o/r/actions/runs/42',
      provider: 'groq',
      model: 'groq/openai/gpt-oss-120b',
      topK: 3,
      recall: 1,
      mrr: 0.9,
      toolAcc: 1,
      judgeScore: 4.5,
      injectionResistance: 0,
      injectionChecked: 0,
      groundedness: 1,
      groundednessChecked: 8,
      thresholds: { recall: 0.8, mrr: 0.6, toolAcc: 0.8, injectionResistance: 1, groundedness: 0.8 },
      perCase: [],
      ...overrides,
    },
  };
}

function result(id: string, passed: boolean): ScenarioResult {
  return {
    id,
    title: `Titel ${id}`,
    passed,
    checks: [{ name: 'Tage', passed, ...(!passed && { detail: '4 statt 3' }) }],
    metrics: { llmCalls: 5, tokens: 6000, costUsd: 0.002, durationMs: 30_000, throttledMs: 0 },
    judge: {},
    replyExcerpt: '',
  };
}

function scenarios(results: ScenarioResult[], overrides: Partial<ScenarioReport> = {}): AnyReport {
  return {
    kind: 'scenarios',
    report: {
      timestamp: '2026-10-10T03:20:00.000Z',
      gitSha: 'abc1234',
      runId: '42',
      runUrl: 'https://github.com/o/r/actions/runs/42',
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      judgeModel: 'groq/openai/gpt-oss-120b',
      summary: summarize(results),
      thresholds: scenarioThresholds(),
      failed: [],
      results,
      ...overrides,
    },
  };
}

test('Wissens- und Szenario-Report desselben Laufs werden ein Eintrag', () => {
  const entries = entriesFromReports([scenarios([result('a', true)]), knowledge()]);
  assert.equal(entries.length, 1);
  const [entry] = entries;
  assert.equal(entry.id, '42:groq');
  // Beginn des Laufs = frühester Report, Modell ohne Anbieter-Präfix
  assert.equal(entry.timestamp, '2026-10-10T03:05:00.000Z');
  assert.equal(entry.model, 'openai/gpt-oss-120b');
  assert.equal(entry.judgeModel, 'groq/openai/gpt-oss-120b');
  assert.equal(entry.knowledge?.recall, 1);
  assert.equal(entry.scenarios?.summary.passed, 1);
});

test('Anbieter im selben Lauf bleiben getrennte Einträge', () => {
  const entries = entriesFromReports([
    knowledge(),
    knowledge({ provider: 'anthropic', model: 'anthropic/claude-haiku-4-5' }),
  ]);
  assert.deepEqual(entries.map((e) => [e.id, e.model]), [
    ['42:groq', 'openai/gpt-oss-120b'],
    ['42:anthropic', 'claude-haiku-4-5'],
  ]);
});

test('Nicht Geprüftes zählt nicht gegen die Wissens-Schwellen', () => {
  const [entry] = entriesFromReports([knowledge()]);
  // injectionChecked: 0 -> null statt 0 %, die Schwelle 100 % greift nicht
  assert.equal(entry.knowledge?.injectionResistance, null);
  assert.equal(entry.knowledge?.passed, true);
  const [failed] = entriesFromReports([knowledge({ recall: 0.5 })]);
  assert.equal(failed.knowledge?.passed, false);
});

test('Fehlschläge tragen ihre Gründe, bestandene Szenarien fehlen', () => {
  const [entry] = entriesFromReports([scenarios([result('a', true), result('b', false)])]);
  assert.deepEqual(entry.scenarios?.failures, [{ id: 'b', title: 'Titel b', reasons: ['Tage (4 statt 3)'] }]);
});

test('mergeHistory ersetzt gleiche IDs, sortiert und kürzt', () => {
  const [first] = entriesFromReports([knowledge({ runId: '1', timestamp: '2026-10-01T03:00:00.000Z' })]);
  const [second] = entriesFromReports([knowledge({ runId: '2', timestamp: '2026-10-02T03:00:00.000Z' })]);
  const [secondAgain] = entriesFromReports([
    knowledge({ runId: '2', timestamp: '2026-10-02T03:00:00.000Z', recall: 0.5 }),
  ]);
  const now = new Date('2026-10-03T00:00:00.000Z');
  let history = mergeHistory(emptyHistory(), [second, first], now);
  assert.deepEqual(history.entries.map((e) => e.id), ['1:groq', '2:groq']);
  history = mergeHistory(history, [secondAgain], now);
  assert.equal(history.entries.length, 2);
  assert.equal(history.entries[1].knowledge?.recall, 0.5);
  assert.equal(history.updatedAt, now.toISOString());
  assert.deepEqual(mergeHistory(history, [], now, 1).entries.map((e) => e.id), ['2:groq']);
});

test('Badge: letzter Groq-Lauf, Farbe nach Ergebnis', () => {
  assert.equal(badgeFor(emptyHistory()).color, 'lightgrey');

  const green = mergeHistory(emptyHistory(), entriesFromReports([knowledge(), scenarios([result('a', true)])]));
  assert.deepEqual(badgeFor(green), {
    schemaVersion: 1,
    label: 'evals',
    message: '1/1 Szenarien · Recall 100 %',
    color: 'brightgreen',
  });

  const mostlyOk = [result('a', true), result('b', true), result('c', true), result('d', false)];
  const yellow = mergeHistory(
    emptyHistory(),
    entriesFromReports([scenarios(mostlyOk, { failed: ['abgebrochen: d'] })]),
  );
  assert.equal(badgeFor(yellow).color, 'yellow');

  const red = mergeHistory(emptyHistory(), entriesFromReports([knowledge({ recall: 0.2 })]));
  assert.equal(badgeFor(red).color, 'red');

  // Ein späterer Anthropic-Lauf ändert das Badge nicht
  const withAnthropic = mergeHistory(
    green,
    entriesFromReports([
      knowledge({ runId: '43', provider: 'anthropic', recall: 0.2, timestamp: '2026-10-11T03:00:00.000Z' }),
    ]),
  );
  assert.equal(badgeFor(withAnthropic).color, 'brightgreen');
});

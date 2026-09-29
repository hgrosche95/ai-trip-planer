import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentLanes } from './agent-lanes.ts';
import { applyRunEvent, initialRunState } from './run-state.ts';
import type { RunEvent, RunEventPayloads } from './run-events.ts';

// Ausschnitt eines Laufs im Multi-Agenten-Modus: Planer, zwei parallele
// Recherchen, Budget
let seq = 0;
function event<T extends RunEvent['type']>(
  type: T,
  elapsedMs: number,
  data: RunEventPayloads[T],
): RunEvent {
  return { type, seq: ++seq, elapsedMs, data } as RunEvent;
}

const TASKS: RunEventPayloads['plan.updated']['tasks'] = [
  { id: 'research:weather', type: 'research:weather', agent: 'research', dependsOn: [], status: 'pending' },
  { id: 'research:lodging', type: 'research:lodging', agent: 'research', dependsOn: [], status: 'pending' },
  { id: 'compose', type: 'compose', agent: 'planner', dependsOn: ['research:weather', 'research:lodging'], status: 'pending' },
];

const EVENTS: RunEvent[] = [
  event('run.started', 0, { runId: 'run-1', mode: 'multi' }),
  event('agent.started', 0, { stepId: 'p1', agent: 'planner', task: 'triage' }),
  event('llm.started', 1, { stepId: 'l1', agent: 'planner', parentStepId: 'p1' }),
  event('llm.call', 1000, {
    stepId: 'l1',
    agent: 'planner',
    model: 'openai/gpt-oss-120b',
    inputTokens: 900,
    outputTokens: 250,
    latencyMs: 999,
    costUsd: 0.0003,
    finishReason: 'stop',
  }),
  event('agent.finished', 1000, {
    stepId: 'p1',
    agent: 'planner',
    task: 'triage',
    status: 'ok',
    durationMs: 1000,
    summary: '3 Tage, 1 Person',
  }),
  event('plan.updated', 1001, { tasks: TASKS }),
  event('agent.started', 1002, { stepId: 'r1', agent: 'research', task: 'research:weather' }),
  event('agent.started', 1002, { stepId: 'r2', agent: 'research', task: 'research:lodging' }),
  event('tool.started', 1003, { stepId: 't1', tool: 'get_weather', agent: 'research', parentStepId: 'r1' }),
  event('agent.finished', 1500, {
    stepId: 'r1',
    agent: 'research',
    task: 'research:weather',
    status: 'ok',
    durationMs: 498,
    summary: '3 Tage, Vorjahreswerte',
  }),
];

test('Reducer: Modus, Agenten-Schritte, Herkunft der Tool-Schritte, lastMs', () => {
  const state = EVENTS.reduce(applyRunEvent, initialRunState());

  assert.equal(state.mode, 'multi');
  assert.deepEqual(
    state.agentSteps.map((step) => [step.agent, step.task, step.status]),
    [
      ['planner', 'triage', 'done'],
      ['research', 'research:weather', 'done'],
      ['research', 'research:lodging', 'running'],
    ],
  );
  assert.equal(state.agentSteps[0].summary, '3 Tage, 1 Person');
  const tool = state.steps.find((step) => step.id === 't1');
  assert.equal(tool?.agent, 'research');
  assert.equal(tool?.parentStepId, 'r1');
  assert.equal(state.tasks.length, 3);
  assert.equal(state.lastMs, 1500);
});

test('Reducer: plan.updated ersetzt die Liste, budget.updated setzt den Bericht', () => {
  const budget: RunEventPayloads['budget.updated'] = {
    currency: 'EUR',
    limitCents: 80_000,
    totalCents: 57_600,
    status: 'ok',
    items: [{ category: 'food', cents: 10_500 }],
  };
  const done = TASKS.map((task) => ({ ...task, status: 'done' as const }));
  const state = [
    ...EVENTS,
    event('plan.updated', 1600, { tasks: done }),
    event('budget.updated', 1700, budget),
  ].reduce(applyRunEvent, initialRunState());

  assert.deepEqual(
    state.tasks.map((task) => task.status),
    ['done', 'done', 'done'],
  );
  assert.deepEqual(state.budget, budget);
});

test('Reducer: Läufe ohne mode (vor Phase 3) gelten als classic', () => {
  const state = applyRunEvent(initialRunState(), {
    type: 'run.started',
    seq: 1,
    elapsedMs: 0,
    data: { runId: 'alt' },
  });
  assert.equal(state.mode, 'classic');
  assert.deepEqual(state.agentSteps, []);
});

test('Lanes: ein Balken pro Schritt, relativ zur Laufzeit, parallele Recherche überlappt', () => {
  const state = EVENTS.reduce(applyRunEvent, initialRunState());
  const { lanes, totalMs } = agentLanes(state);

  assert.equal(totalMs, 1500);
  assert.deepEqual(
    lanes.map((lane) => [lane.label, lane.bars.length]),
    [
      ['Planer', 1],
      ['Recherche', 2],
    ],
  );
  const [triage] = lanes[0].bars;
  assert.equal(triage.leftPct, 0);
  assert.ok(Math.abs(triage.widthPct - (1000 / 1500) * 100) < 0.01);
  assert.equal(triage.tokens, 1150);

  // Beide Recherchen starten gleichzeitig; die laufende reicht bis lastMs
  const [weather, lodging] = lanes[1].bars;
  assert.equal(weather.leftPct, lodging.leftPct);
  assert.ok(Math.abs(lodging.leftPct + lodging.widthPct - 100) < 0.01);
  assert.ok(lodging.leftPct + lodging.widthPct <= 100);
});

test('Lanes: ohne Agenten-Schritte (classic) keine Lanes', () => {
  const { lanes } = agentLanes(initialRunState());
  assert.deepEqual(lanes, []);
});

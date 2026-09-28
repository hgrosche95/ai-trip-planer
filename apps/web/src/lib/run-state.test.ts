import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRunEvent, initialRunState } from './run-state.ts';
import type { RunEvent } from './run-events.ts';

// Ein typischer Lauf, wie ihn POST /agent/runs schickt
const EVENTS: RunEvent[] = [
  { type: 'run.started', seq: 1, elapsedMs: 0, data: {} },
  { type: 'llm.started', seq: 2, elapsedMs: 5, data: { stepId: 'l1' } },
  {
    type: 'llm.call',
    seq: 3,
    elapsedMs: 900,
    data: {
      stepId: 'l1',
      model: 'openai/gpt-oss-120b',
      inputTokens: 1800,
      outputTokens: 40,
      latencyMs: 895,
      costUsd: 0.0003,
      finishReason: 'tool_calls',
    },
  },
  { type: 'tool.started', seq: 4, elapsedMs: 901, data: { stepId: 't1', tool: 'show_destination_on_globe' } },
  {
    type: 'tool.finished',
    seq: 5,
    elapsedMs: 902,
    data: { stepId: 't1', tool: 'show_destination_on_globe', kind: 'tool', latencyMs: 1, ok: true },
  },
  { type: 'place.added', seq: 6, elapsedMs: 902, data: { name: 'Berlin', lat: 52.5, lng: 13.4, kind: 'origin' } },
  {
    type: 'route.added',
    seq: 7,
    elapsedMs: 902,
    data: { from: { name: 'Berlin', lat: 52.5, lng: 13.4 }, to: { name: 'Lissabon', lat: 38.7, lng: -9.1 } },
  },
  { type: 'place.added', seq: 8, elapsedMs: 902, data: { name: 'Lissabon', lat: 38.7, lng: -9.1, kind: 'destination' } },
  { type: 'message.completed', seq: 9, elapsedMs: 2000, data: { text: 'Los geht es!' } },
];

test('baut aus den Ereignissen Timeline, Globus-Daten und Antwort', () => {
  const state = EVENTS.reduce(applyRunEvent, initialRunState());

  assert.equal(state.steps.length, 2);
  assert.deepEqual(
    state.steps.map((step) => [step.kind, step.name, step.status]),
    [
      ['llm', 'openai/gpt-oss-120b', 'done'],
      ['tool', 'show_destination_on_globe', 'done'],
    ],
  );
  assert.equal(state.steps[0].inputTokens, 1800);
  assert.deepEqual(
    state.places.map((place) => place.name),
    ['Berlin', 'Lissabon'],
  );
  assert.equal(state.routes.length, 1);
  assert.equal(state.reply, 'Los geht es!');
  assert.equal(state.status, 'running');
});

test('zeigt einen gestarteten, noch nicht fertigen Schritt als laufend', () => {
  const state = EVENTS.slice(0, 2).reduce(applyRunEvent, initialRunState());
  assert.equal(state.steps[0].status, 'running');
});

test('zählt einen Ort nur einmal, auch wenn er doppelt gemeldet wird', () => {
  const place = EVENTS[7];
  const state = [place, { ...place, seq: 10 }].reduce(applyRunEvent, initialRunState());
  assert.equal(state.places.length, 1);
});

test('markiert fehlgeschlagene Tools und Laufabbrüche', () => {
  const state = [
    EVENTS[3],
    { ...EVENTS[4], data: { ...(EVENTS[4].data as object), ok: false } } as RunEvent,
    {
      type: 'run.error',
      seq: 6,
      elapsedMs: 950,
      data: { code: 'rate_limited', message: 'Zu viele Anfragen' },
    } as RunEvent,
  ].reduce(applyRunEvent, initialRunState());

  assert.equal(state.steps[0].status, 'error');
  assert.equal(state.status, 'error');
  assert.equal(state.error, 'Zu viele Anfragen');
});

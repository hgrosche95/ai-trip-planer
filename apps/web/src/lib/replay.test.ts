import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globeView, replayDurationMs, replaySchedule } from './replay.ts';
import { applyRunEvent, initialRunState } from './run-state.ts';
import type { RunEvent } from './run-events.ts';

function at(seq: number, elapsedMs: number): RunEvent {
  return { type: 'llm.started', seq, elapsedMs, data: { stepId: `l${seq}` } };
}

test('rafft die Abstände zwischen den Ereignissen um den Faktor', () => {
  const schedule = replaySchedule([at(1, 0), at(2, 300), at(3, 900)], 3);
  assert.deepEqual(
    schedule.map((step) => step.delayMs),
    [0, 100, 200],
  );
});

test('kappt lange Pausen, damit das Replay nicht stehen bleibt', () => {
  const schedule = replaySchedule([at(1, 0), at(2, 30_000), at(3, 30_300)], 3, 1500);
  assert.deepEqual(
    schedule.map((step) => step.delayMs),
    [0, 1500, 100],
  );
  assert.equal(replayDurationMs(schedule), 1600);
});

test('spielt nach seq ab, auch wenn die Liste anders sortiert ist', () => {
  const schedule = replaySchedule([at(3, 900), at(1, 0), at(2, 300)], 3);
  assert.deepEqual(
    schedule.map((step) => step.event.seq),
    [1, 2, 3],
  );
});

test('wertet rückwärts laufende Zeitstempel als Pause 0', () => {
  const schedule = replaySchedule([at(1, 500), at(2, 400), at(3, 800)], 1);
  assert.deepEqual(
    schedule.map((step) => step.delayMs),
    [500, 0, 300],
  );
});

test('ist bei unendlicher Geschwindigkeit sofort fertig', () => {
  const schedule = replaySchedule([at(1, 0), at(2, 5000)], Infinity);
  assert.equal(replayDurationMs(schedule), 0);
});

test('lehnt eine Geschwindigkeit von 0 ab', () => {
  assert.throws(() => replaySchedule([at(1, 0)], 0), RangeError);
});

test('baut den Globus wie im Chat aus Orten, Bögen und Route', () => {
  const berlin = { name: 'Berlin', lat: 52.5, lng: 13.4 };
  const lissabon = { name: 'Lissabon', lat: 38.7, lng: -9.1 };
  const events: RunEvent[] = [
    { type: 'place.added', seq: 1, elapsedMs: 1, data: { ...berlin, kind: 'origin' } },
    { type: 'place.added', seq: 2, elapsedMs: 2, data: { ...lissabon, kind: 'destination' } },
    { type: 'route.added', seq: 3, elapsedMs: 3, data: { from: berlin, to: lissabon } },
  ];

  const view = globeView(events.reduce(applyRunEvent, initialRunState()));

  assert.deepEqual(view.focus, lissabon);
  assert.deepEqual(view.places, [berlin, lissabon]);
  assert.deepEqual(view.arcs, [{ from: [52.5, 13.4], to: [38.7, -9.1] }]);
  assert.equal(view.route, null);

  const withStops = applyRunEvent(events.reduce(applyRunEvent, initialRunState()), {
    type: 'stops.updated',
    seq: 4,
    elapsedMs: 4,
    data: { stops: [berlin, lissabon] },
  });
  assert.deepEqual(globeView(withStops).route, [berlin, lissabon]);
});

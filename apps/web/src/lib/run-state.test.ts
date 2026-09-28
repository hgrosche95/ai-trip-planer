import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRunEvent, initialRunState } from './run-state.ts';
import type { RunEvent } from './run-events.ts';

// Ein typischer Lauf, wie ihn POST /agent/runs schickt
const EVENTS: RunEvent[] = [
  { type: 'run.started', seq: 1, elapsedMs: 0, data: { runId: 'run-1' } },
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
  // für den Link "Lauf erneut abspielen"
  assert.equal(state.runId, 'run-1');
});

test('übernimmt die Stationen einer Route', () => {
  const stops = [
    { name: 'Wien', lat: 48.2, lng: 16.37 },
    { name: 'Prag', lat: 50.08, lng: 14.43 },
  ];
  const state = applyRunEvent(initialRunState(), {
    type: 'stops.updated',
    seq: 1,
    elapsedMs: 10,
    data: { stops },
  });
  assert.deepEqual(state.stops, stops);
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

test('sammelt Wetter pro Ort, ein erneuter Bericht ersetzt den alten', () => {
  const report = (tMax: number): RunEvent => ({
    type: 'weather.updated',
    seq: 1,
    elapsedMs: 10,
    data: {
      place: { name: 'Lissabon', lat: 38.72, lng: -9.14 },
      source: 'forecast',
      days: [{ date: '2026-10-03', tMin: 15, tMax, precipMm: 0, code: 0, label: 'Klar' }],
    },
  });
  const porto: RunEvent = {
    type: 'weather.updated',
    seq: 2,
    elapsedMs: 20,
    data: { place: { name: 'Porto', lat: 41.15, lng: -8.61 }, source: 'climate', days: [] },
  };

  const state = [report(22), porto, report(25)].reduce(applyRunEvent, initialRunState());

  assert.deepEqual(
    state.weather.map((entry) => [entry.place.name, entry.source]),
    [
      ['Lissabon', 'forecast'],
      ['Porto', 'climate'],
    ],
  );
  assert.equal(state.weather[0].days[0].tMax, 25);
});

test('merkt sich Cache-Treffer eines Tools', () => {
  const state = [
    { type: 'tool.started', seq: 1, elapsedMs: 1, data: { stepId: 'w1', tool: 'get_weather' } },
    {
      type: 'tool.finished',
      seq: 2,
      elapsedMs: 3,
      data: { stepId: 'w1', tool: 'get_weather', kind: 'tool', latencyMs: 2, ok: true, cached: true },
    },
  ].reduce((current, event) => applyRunEvent(current, event as RunEvent), initialRunState());

  assert.equal(state.steps[0].cached, true);
});

test('sammelt Unterkünfte pro Ort, ein erneuter Bericht ersetzt den alten', () => {
  const hotel = (name: string, priceMinEur: number) => ({
    name,
    lat: 48.2,
    lng: 16.37,
    kind: 'hotel' as const,
    priceMinEur,
    priceMaxEur: priceMinEur + 80,
  });
  const lodging = (seq: number, place: string, items: ReturnType<typeof hotel>[]): RunEvent => ({
    type: 'lodging.updated',
    seq,
    elapsedMs: seq * 10,
    data: { place: { name: place, lat: 48.21, lng: 16.37 }, items },
  });

  const state = [
    lodging(1, 'Wien', [hotel('Hotel Sacher', 180)]),
    lodging(2, 'Rom', [hotel('Hotel Artemide', 95)]),
    lodging(3, 'Wien', [hotel('Pension Nossek', 65), hotel('Hotel Sacher', 180)]),
  ].reduce(applyRunEvent, initialRunState());

  assert.deepEqual(
    state.lodging.map((report) => [report.place.name, report.items.map((item) => item.name)]),
    [
      ['Wien', ['Pension Nossek', 'Hotel Sacher']],
      ['Rom', ['Hotel Artemide']],
    ],
  );
  // Wetter bleibt davon unberührt
  assert.deepEqual(state.weather, []);
});

test('übernimmt die Such-Links eines Unterkunftsberichts, auch ohne Einträge', () => {
  const searchLinks = {
    booking: 'https://www.booking.com/searchresults.html?ss=Wien&group_adults=2&no_rooms=1',
    airbnb: 'https://www.airbnb.de/s/Wien/homes?adults=2',
  };
  const state = applyRunEvent(initialRunState(), {
    type: 'lodging.updated',
    seq: 1,
    elapsedMs: 1,
    data: { place: { name: 'Wien', lat: 48.21, lng: 16.37 }, searchLinks, items: [] },
  });

  assert.deepEqual(state.lodging[0].searchLinks, searchLinks);
});

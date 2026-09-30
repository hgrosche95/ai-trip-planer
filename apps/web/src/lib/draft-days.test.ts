import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayDate, draftDays } from './draft-days.ts';
import type { ItineraryDraft, WeatherDay } from './run-events.ts';

function draft(stops: [dayNumber: number, order: number, title: string][]): ItineraryDraft {
  return {
    destination: 'Lissabon',
    startDate: '2026-10-14',
    endDate: '2026-10-16',
    budgetCents: 80_000,
    currency: 'EUR',
    preferences: [],
    stops: stops.map(([dayNumber, order, title]) => ({ dayNumber, order, title })),
  };
}

test('dayDate zählt Kalendertage ab dem Start, auch über Monatsgrenzen', () => {
  assert.equal(dayDate('2026-10-14', 1), '2026-10-14');
  assert.equal(dayDate('2026-10-31', 2), '2026-11-01');
  assert.equal(dayDate('2026-10-14T00:00:00.000Z', 3), '2026-10-16');
});

test('draftDays ordnet Punkte pro Tag und liefert auch leere Tage', () => {
  const days = draftDays(draft([[1, 2, 'Fado'], [1, 1, 'Alfama']]));
  assert.equal(days.length, 3);
  assert.deepEqual(days[0].stops.map((stop) => stop.title), ['Alfama', 'Fado']);
  assert.deepEqual(days[2].stops, []);
  assert.equal(days[2].date, '2026-10-16');
});

test('ohne vorige Fassung ist nichts neu und nichts entfallen', () => {
  const [day] = draftDays(draft([[1, 1, 'Alfama']]));
  assert.equal(day.stops[0].isNew, false);
  assert.deepEqual(day.removed, []);
});

test('gegen die vorige Fassung: neue Punkte markiert, entfallene gelistet', () => {
  const before = draft([[3, 1, 'Museu Gulbenkian'], [3, 2, 'Mittag in der Baixa'], [1, 1, 'Alfama']]);
  const after = draft([[3, 1, 'museu gulbenkian '], [3, 2, 'Garten der Gulbenkian'], [1, 1, 'Alfama']]);
  const days = draftDays(after, before);
  assert.deepEqual(
    days[2].stops.map((stop) => [stop.title, stop.isNew]),
    [
      ['museu gulbenkian ', false],
      ['Garten der Gulbenkian', true],
    ],
  );
  assert.deepEqual(days[2].removed, ['Mittag in der Baixa']);
  assert.deepEqual(days[0].removed, []);
});

test('Wetter wird dem Tag über das Datum zugeordnet', () => {
  const weather: WeatherDay[] = [
    { date: '2026-10-15', tMin: 15, tMax: 22, precipMm: 6, code: 63, label: 'Regen' },
  ];
  const days = draftDays(draft([]), undefined, weather);
  assert.equal(days[0].weather, undefined);
  assert.equal(days[1].weather?.precipMm, 6);
});

test('Punkte hinter dem Enddatum verlängern die Tage statt zu verschwinden', () => {
  const days = draftDays(draft([[4, 1, 'Sintra']]));
  assert.equal(days.length, 4);
  assert.equal(days[3].stops[0].title, 'Sintra');
});

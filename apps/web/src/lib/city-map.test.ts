import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayNumbers, dayRoutes, mapStops, stopBounds } from './city-map.ts';

const stops = [
  { dayNumber: 2, order: 2, title: 'Pastéis', lat: 38.6975, lng: -9.2032 },
  { dayNumber: 1, order: 1, title: 'Alfama', lat: 38.7123, lng: -9.1302 },
  { dayNumber: 2, order: 1, title: 'Torre', lat: 38.6916, lng: -9.216 },
  { dayNumber: 1, order: 2, title: 'Ohne Ort' },
  { dayNumber: 1, order: 3, title: 'Fado', lat: 38.711, lng: -9.1275 },
];

test('Nur Punkte mit Ort, nummeriert pro Tag nach Reihenfolge', () => {
  const result = mapStops(stops);
  assert.deepEqual(
    result.map((stop) => `${stop.dayNumber}.${stop.index} ${stop.title}`),
    // Die Nummer zählt auch Punkte ohne Ort, damit sie zur Liste passt
    ['1.1 Alfama', '1.3 Fado', '2.1 Torre', '2.2 Pastéis'],
  );
});

test('Ein Weg pro Tag in [lng, lat], Tage mit einem Punkt ohne Weg', () => {
  const routes = dayRoutes(mapStops(stops));
  assert.deepEqual(routes, [
    { dayNumber: 1, coordinates: [[-9.1302, 38.7123], [-9.1275, 38.711]] },
    { dayNumber: 2, coordinates: [[-9.216, 38.6916], [-9.2032, 38.6975]] },
  ]);
  assert.deepEqual(dayRoutes(mapStops([stops[1]])), []);
});

test('Ausschnitt umfasst alle Punkte, ohne Punkte keiner', () => {
  assert.deepEqual(stopBounds(mapStops(stops)), [
    [-9.216, 38.6916],
    [-9.1275, 38.7123],
  ]);
  assert.equal(stopBounds([]), null);
});

test('Tage sortiert und eindeutig', () => {
  assert.deepEqual(dayNumbers(stops), [1, 2]);
});

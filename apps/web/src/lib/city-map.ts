// Daten für die Stadtkarte neben dem Plan: Programmpunkte mit Ort, pro Tag
// ein Weg in Reihenfolge, und der Ausschnitt, der alle Punkte zeigt.

export interface MapStopInput {
  dayNumber: number;
  order: number;
  title: string;
  lat?: number | null;
  lng?: number | null;
}

export interface MapStop {
  dayNumber: number;
  // Nummer innerhalb des Tages, 1-basiert (steht im Marker)
  index: number;
  title: string;
  lat: number;
  lng: number;
}

// Nur Punkte mit Ort, pro Tag nach order nummeriert
export function mapStops(stops: MapStopInput[]): MapStop[] {
  const sorted = [...stops].sort((a, b) => a.dayNumber - b.dayNumber || a.order - b.order);
  const counters = new Map<number, number>();
  const result: MapStop[] = [];
  for (const stop of sorted) {
    const index = (counters.get(stop.dayNumber) ?? 0) + 1;
    counters.set(stop.dayNumber, index);
    if (stop.lat == null || stop.lng == null) continue;
    result.push({ dayNumber: stop.dayNumber, index, title: stop.title, lat: stop.lat, lng: stop.lng });
  }
  return result;
}

// Ein Weg pro Tag mit mindestens zwei Punkten, als [lng, lat] wie GeoJSON
export function dayRoutes(stops: MapStop[]): { dayNumber: number; coordinates: [number, number][] }[] {
  const byDay = new Map<number, [number, number][]>();
  for (const stop of stops) {
    const line = byDay.get(stop.dayNumber) ?? [];
    line.push([stop.lng, stop.lat]);
    byDay.set(stop.dayNumber, line);
  }
  return [...byDay.entries()]
    .filter(([, coordinates]) => coordinates.length > 1)
    .map(([dayNumber, coordinates]) => ({ dayNumber, coordinates }));
}

// [[west, süd], [ost, nord]] oder null ohne Punkte
export function stopBounds(stops: MapStop[]): [[number, number], [number, number]] | null {
  if (stops.length === 0) return null;
  const lngs = stops.map((stop) => stop.lng);
  const lats = stops.map((stop) => stop.lat);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

export function dayNumbers(stops: { dayNumber: number }[]): number[] {
  return [...new Set(stops.map((stop) => stop.dayNumber))].sort((a, b) => a - b);
}

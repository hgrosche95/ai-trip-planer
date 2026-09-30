import type { ItineraryDraft, WeatherDay } from './run-events';

type DraftStop = ItineraryDraft['stops'][number];

// Ein Tag des Entwurfs auf der Arbeitsfläche. isNew und removed vergleichen
// mit der vorigen Fassung: So sieht man, was eine Folgenachricht geändert hat.
export interface DraftDay {
  dayNumber: number;
  // Kalendertag als YYYY-MM-DD, passend zu WeatherDay.date
  date: string;
  stops: (DraftStop & { isNew: boolean })[];
  // Titel, die in der vorigen Fassung an diesem Tag standen und jetzt fehlen
  removed: string[];
  weather?: WeatherDay;
}

// Reisetage sind Kalendertage: in UTC rechnen, damit die Zeitzone des
// Browsers das Datum nicht verschiebt
export function dayDate(startDate: string, dayNumber: number): string {
  const date = new Date(`${startDate.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + dayNumber - 1);
  return date.toISOString().slice(0, 10);
}

function dayCount(draft: ItineraryDraft): number {
  const start = Date.parse(`${draft.startDate.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${draft.endDate.slice(0, 10)}T00:00:00Z`);
  const byDates = Number.isNaN(start) || Number.isNaN(end) ? 0 : (end - start) / 86_400_000 + 1;
  const byStops = Math.max(0, ...draft.stops.map((stop) => stop.dayNumber));
  return Math.max(byDates, byStops);
}

const normalize = (title: string) => title.trim().toLowerCase();

// Tage des Entwurfs mit ihren Programmpunkten in Reihenfolge, auch Tage ohne
// Punkte. Ohne vorige Fassung ist nichts neu und nichts entfallen.
export function draftDays(
  draft: ItineraryDraft,
  previous?: ItineraryDraft,
  weather: WeatherDay[] = [],
): DraftDay[] {
  const titlesOn = (source: ItineraryDraft, dayNumber: number) =>
    source.stops.filter((stop) => stop.dayNumber === dayNumber).map((stop) => stop.title);

  return Array.from({ length: dayCount(draft) }, (_, index) => {
    const dayNumber = index + 1;
    const date = dayDate(draft.startDate, dayNumber);
    const stops = draft.stops
      .filter((stop) => stop.dayNumber === dayNumber)
      .sort((a, b) => a.order - b.order);
    const before = previous ? new Set(titlesOn(previous, dayNumber).map(normalize)) : null;
    const now = new Set(stops.map((stop) => normalize(stop.title)));
    return {
      dayNumber,
      date,
      stops: stops.map((stop) => ({ ...stop, isNew: before !== null && !before.has(normalize(stop.title)) })),
      removed: previous
        ? titlesOn(previous, dayNumber).filter((title) => !now.has(normalize(title)))
        : [],
      weather: weather.find((day) => day.date === date),
    };
  });
}

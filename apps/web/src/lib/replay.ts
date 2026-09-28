import type { GlobePoint, RunEvent } from './run-events';
import type { RunState } from './run-state';

// Standard-Zeitraffer für /replay: dreimal so schnell wie der echte Lauf
export const REPLAY_SPEED = 3;
// Längste Pause zwischen zwei Ereignissen nach dem Raffen. Ein LLM-Aufruf,
// der im Original 20 s dauerte, soll im Replay nicht 7 s lang nichts zeigen.
export const MAX_REPLAY_GAP_MS = 1500;

export interface ReplayStep {
  event: RunEvent;
  // Wartezeit vor diesem Ereignis, gemessen ab dem vorigen
  delayMs: number;
}

// Zeitplan für das Abspielen eines gespeicherten Laufs: Reihenfolge nach seq,
// Abstände aus elapsedMs geteilt durch `speed` und auf `maxGapMs` gekappt.
// Rein und ohne Timer, damit sich das Raffen ohne Browser testen lässt; die
// Seite ruft nur noch setTimeout mit den Werten auf.
export function replaySchedule(
  events: RunEvent[],
  speed = REPLAY_SPEED,
  maxGapMs = MAX_REPLAY_GAP_MS,
): ReplayStep[] {
  if (!(speed > 0)) throw new RangeError('speed muss größer als 0 sein');
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  let previousMs = 0;
  return ordered.map((event) => {
    // Negative Abstände (Uhren weichen ab, Ereignisse gekürzt) als 0 werten
    const gap = Math.max(0, event.elapsedMs - previousMs);
    previousMs = Math.max(previousMs, event.elapsedMs);
    return { event, delayMs: Math.round(Math.min(gap / speed, maxGapMs)) };
  });
}

// Gesamtdauer eines Zeitplans, für die Anzeige "ca. x s"
export function replayDurationMs(schedule: ReplayStep[]): number {
  return schedule.reduce((sum, step) => sum + step.delayMs, 0);
}

export interface GlobeView {
  focus: GlobePoint | null;
  places: GlobePoint[];
  arcs: { from: [number, number]; to: [number, number] }[];
  route: GlobePoint[] | null;
}

// Was der Globus für einen Laufzustand zeigt, wie im Chat: alle gemeldeten
// Orte als Marker, das zuletzt gemeldete Ziel im Fokus, Bögen aus
// route.added, und eine Route aus stops.updated hat Vorrang.
export function globeView(state: RunState): GlobeView {
  const destinations = state.places.filter((place) => place.kind === 'destination');
  const focus = destinations.at(-1);
  return {
    focus: focus ? { name: focus.name, lat: focus.lat, lng: focus.lng } : null,
    places: state.places.map(({ name, lat, lng }) => ({ name, lat, lng })),
    arcs: state.routes.map(({ from, to }) => ({
      from: [from.lat, from.lng],
      to: [to.lat, to.lng],
    })),
    route: state.stops.length > 0 ? state.stops : null,
  };
}

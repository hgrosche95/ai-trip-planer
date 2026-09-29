import type { RunState } from './run-state';

// Was unter einer Antwort mit Entwurf steht: "Plan speichern" nur beim
// neuesten Entwurf des Chats. Ältere Entwürfe hat eine Folgenachricht
// überarbeitet oder eine neue Reise ersetzt; die API arbeitet nur mit dem
// neuesten weiter, und zwei Buttons für fast denselben Plan würden verwirren.
export type DraftVersion = 'latest' | 'superseded';

// Pro Antwort (in Reihenfolge des Chats) ihr Stand, undefined ohne Entwurf.
// Nur abgeschlossene Läufe zählen: Ein abgebrochener Lauf löst den vorigen
// Entwurf nicht ab.
export function draftVersions(traces: (RunState | undefined)[]): (DraftVersion | undefined)[] {
  const hasDraft = (trace: RunState | undefined) =>
    trace?.status === 'done' && trace.draft !== undefined;
  let latest = -1;
  traces.forEach((trace, index) => {
    if (hasDraft(trace)) latest = index;
  });
  return traces.map((trace, index) => {
    if (!hasDraft(trace)) return undefined;
    return index === latest ? 'latest' : 'superseded';
  });
}

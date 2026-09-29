import type { GlobePoint, Violation } from './run-events';
import type { CritiqueRound } from './run-state';

// Ein beanstandeter Programmpunkt auf dem Globus: rot, solange der Befund
// offen ist, grün, sobald eine Nachbesserung ihn behoben hat.
export interface IssueMarker extends GlobePoint {
  resolved: boolean;
}

// Derselbe Befund über mehrere Runden: gleiche Regel, gleicher Tag, gleicher
// Programmpunkt
function issueKey(violation: Violation): string {
  return `${violation.ruleId}|${violation.dayNumber ?? '-'}|${violation.stopTitle ?? ''}`;
}

// Fehler mit Ort aus allen Runden, jeder einmal. Behoben ist ein Fehler,
// wenn die letzte Runde ihn nicht mehr meldet. Hinweise (warning) bekommen
// keinen Ring: Der Planer bessert sie nicht nach.
export function issueMarkers(critiques: CritiqueRound[]): IssueMarker[] {
  const last = critiques.at(-1);
  if (!last) return [];
  const open = new Set(last.violations.map(issueKey));
  const seen = new Set<string>();
  const markers: IssueMarker[] = [];
  for (const round of critiques) {
    for (const violation of round.violations) {
      const key = issueKey(violation);
      if (violation.severity !== 'error' || seen.has(key)) continue;
      if (violation.lat === undefined || violation.lng === undefined) continue;
      seen.add(key);
      markers.push({
        name: violation.stopTitle ?? violation.message,
        lat: violation.lat,
        lng: violation.lng,
        resolved: !open.has(key),
      });
    }
  }
  return markers;
}

export interface CritiqueOverview {
  // Fehler im ersten Entwurf und nach der letzten Nachbesserung
  firstErrors: number;
  lastErrors: number;
  repairs: number;
  // Behobene Fehler (in einer früheren Runde gemeldet, zuletzt nicht mehr)
  resolved: Violation[];
  // Befunde der letzten Runde: offene Fehler und Hinweise
  open: Violation[];
}

export function critiqueOverview(critiques: CritiqueRound[]): CritiqueOverview | null {
  const first = critiques[0];
  const last = critiques.at(-1);
  if (!first || !last) return null;
  const errors = (round: CritiqueRound) =>
    round.violations.filter((violation) => violation.severity === 'error');
  const open = new Set(last.violations.map(issueKey));
  const resolved = new Map<string, Violation>();
  for (const round of critiques.slice(0, -1)) {
    for (const violation of errors(round)) {
      const key = issueKey(violation);
      if (!open.has(key) && !resolved.has(key)) resolved.set(key, violation);
    }
  }
  return {
    firstErrors: errors(first).length,
    lastErrors: errors(last).length,
    repairs: critiques.length - 1,
    resolved: [...resolved.values()],
    open: last.violations,
  };
}

// Kurzform für das Badge: "1 Fehler → Nachbesserung 1 → 0 Fehler"
export function critiqueBadge(overview: CritiqueOverview): string {
  const errors = (n: number) => `${n} Fehler`;
  if (overview.repairs === 0) {
    const warnings = overview.open.length - overview.lastErrors;
    return overview.open.length === 0
      ? 'keine Befunde'
      : `${errors(overview.lastErrors)}, ${warnings} ${warnings === 1 ? 'Hinweis' : 'Hinweise'}`;
  }
  const steps = overview.repairs === 1 ? 'Nachbesserung' : `${overview.repairs} Nachbesserungen`;
  return `${errors(overview.firstErrors)} → ${steps} → ${errors(overview.lastErrors)}`;
}

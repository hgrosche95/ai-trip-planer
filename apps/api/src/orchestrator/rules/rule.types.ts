import type { Violation } from '../../runs/run-events';
import type { BudgetReport } from '../agents/budget.agent';
import type {
  DraftStop,
  ResearchFindings,
  TripBrief,
  TripDraft,
} from '../trip-draft';

export type { Violation } from '../../runs/run-events';

// Alles, was eine Regel sehen darf: Eckdaten, Entwurf, Recherche, Budget.
// Regeln sind reine Funktionen ohne LLM und ohne Netz: deterministisch
// testbar, kostenlos, und die Evals können sie auf dem fertigen Plan
// unabhängig vom Kritiker nachrechnen.
// Deshalb importieren die Regeln außer Typen nur Dateien ohne weitere
// Abhängigkeiten (format.ts, haversineKm): evals/ lädt sie direkt.
export interface RuleInput {
  brief: TripBrief;
  draft: TripDraft;
  findings: ResearchFindings;
  budget: BudgetReport;
}

export interface Rule {
  id: string;
  // Was die Regel prüft, für Doku und Tests
  description: string;
  check(input: RuleInput): Violation[];
}

// Datum eines Reisetags (1 = Abreisetag)
export function dateOfDay(startDate: string, dayNumber: number): string {
  const date = new Date(`${startDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + dayNumber - 1);
  return date.toISOString().slice(0, 10);
}

// Ort eines Programmpunkts für den Ring auf dem Globus
export function stopRef(
  stop: DraftStop,
): Pick<Violation, 'dayNumber' | 'stopTitle' | 'lat' | 'lng'> {
  return {
    dayNumber: stop.dayNumber,
    stopTitle: stop.title,
    ...(stop.lat !== undefined && stop.lng !== undefined
      ? { lat: stop.lat, lng: stop.lng }
      : {}),
  };
}

// Anreise, Abreise und Unterkunft sind kein Programm: Sie dürfen sich
// wiederholen, draußen liegen (Bahnhof) und beim Abreiseort liegen.
export function isProgram(stop: DraftStop): boolean {
  return stop.category !== 'TRANSPORT' && stop.category !== 'ACCOMMODATION';
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

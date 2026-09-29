import { daysBetween } from '../external/open-meteo.client';
import type { CreateItineraryInput } from '../itineraries.service';
import { itineraryValidationErrors } from '../itinerary.dto';
import type { AgentName, TaskStatus, TaskType } from '../runs/run-events';
import type {
  ChatSource,
  GlobeFocus,
  ToolLodging,
  ToolWeather,
} from '../tools';
import type {
  TransportMode,
  TransportOption,
} from '../tools/transport-estimate.tool';
import { isIsoDate } from '../tools/weather.tool';

// Die drei Datenstrukturen, die zwischen den Agenten wandern:
//
//   Nachricht ─triage→ TripBrief ─plan→ TaskPlan ─research→ Findings
//                                         └──────compose→ TripDraft ─budget→ BudgetReport
//
// Alles, was der Code prüfen kann, prüft der Code: Das Modell liefert nur
// die Teile, für die es Sprache und Weltwissen braucht (Ziel und Daten aus
// dem Freitext, Programmpunkte), und jede seiner Ausgaben geht durch eine
// Validierung, bevor ein anderer Agent sie sieht.

// Längere Reisen plant der Classic-Agent: Das Wetter-Tool liefert höchstens
// 14 Tage, und ein Tagesplan dafür sprengt die Ausgabe eines Aufrufs.
export const MAX_TRIP_DAYS = 14;
const MAX_TRAVELERS = 16;
const MAX_PREFERENCES = 10;
const MAX_ASSUMPTIONS = 6;

// Unterkunftsniveau, wenn der Nutzer eines nennt ("günstig übernachten",
// "gutes Hotel"). Ohne Angabe rechnet das Budget mit Mittelklasse.
export const LODGING_LEVELS = ['budget', 'mid', 'upscale'] as const;
export type LodgingLevel = (typeof LODGING_LEVELS)[number];

// Eckdaten der Reise aus der triage des Planers
export interface TripBrief {
  destination: string;
  origin?: string;
  startDate: string;
  endDate: string;
  // true: Der Nutzer hat nur Monat oder Dauer genannt, der Planer hat
  // konkrete Daten gewählt. Die Antwort sagt das dazu.
  datesAssumed: boolean;
  travelers: number;
  // Gesamtbudget für alle Reisenden, wie genannt
  budget?: { amount: number; currency: string };
  preferences: string[];
  lodging?: LodgingLevel;
  // Was der Planer ergänzt hat, weil der Nutzer es nicht genannt hat
  // (Personenzahl, Interessen, Unterkunftsniveau), als kurze deutsche
  // Stichpunkte. Die Antwort nennt sie offen, statt vorab nachzufragen.
  assumptions: string[];
}

export interface PlanTask {
  id: string;
  type: TaskType;
  agent: AgentName;
  dependsOn: string[];
  status: TaskStatus;
}

export interface TaskPlan {
  tasks: PlanTask[];
}

// outdoor: Das Modell sagt, ob der Punkt draußen stattfindet (Regel
// rain-outdoor des Kritikers). Nur im Entwurf, nicht im gespeicherten Plan.
export type DraftStop = CreateItineraryInput['stops'][number] & {
  outdoor?: boolean;
};

// Der Entwurf hat dieselbe Form wie ein gespeicherter Plan
// (save_itinerary), damit er ohne Umbau gespeichert werden kann.
export type TripDraft = Omit<CreateItineraryInput, 'stops'> & {
  currency: string;
  stops: DraftStop[];
};

export function tripDays(brief: Pick<TripBrief, 'startDate' | 'endDate'>) {
  return daysBetween(brief.startDate, brief.endDate) + 1;
}

export function tripNights(brief: Pick<TripBrief, 'startDate' | 'endDate'>) {
  return daysBetween(brief.startDate, brief.endDate);
}

// Prüft die Eckdaten aus der triage. Liefert Fehler statt zu werfen: Der
// Planer macht daraus eine Rückfrage an den Nutzer.
export function parseTripBrief(
  raw: unknown,
  today: string,
): { brief: TripBrief } | { errors: string[] } {
  const input = (raw ?? {}) as Record<string, unknown>;
  const errors: string[] = [];

  const destination = shortText(input.destination, 100);
  if (!destination) errors.push('Reiseziel fehlt');
  const origin = shortText(input.origin, 100);

  const { startDate, endDate } = input;
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    errors.push('Reisezeitraum fehlt');
  } else if (endDate < startDate) {
    errors.push('Rückreise liegt vor der Abreise');
  } else if (startDate < today) {
    errors.push('Reisezeitraum liegt in der Vergangenheit');
  } else if (daysBetween(startDate, endDate) + 1 > MAX_TRIP_DAYS) {
    errors.push(`Reise länger als ${MAX_TRIP_DAYS} Tage`);
  }

  const travelers =
    typeof input.travelers === 'number' &&
    Number.isInteger(input.travelers) &&
    input.travelers >= 1 &&
    input.travelers <= MAX_TRAVELERS
      ? input.travelers
      : 1;

  const rawBudget = input.budget as
    { amount?: unknown; currency?: unknown } | null | undefined;
  const amount = rawBudget?.amount;
  const currency =
    typeof rawBudget?.currency === 'string'
      ? rawBudget.currency.trim().toUpperCase()
      : 'EUR';
  const budget =
    typeof amount === 'number' &&
    Number.isFinite(amount) &&
    amount > 0 &&
    amount <= 1_000_000 &&
    /^[A-Z]{3}$/.test(currency)
      ? { amount, currency }
      : undefined;

  const preferences = Array.isArray(input.preferences)
    ? input.preferences
        .map((entry) => shortText(entry, 100))
        .filter((entry): entry is string => entry !== undefined)
        .slice(0, MAX_PREFERENCES)
    : [];

  const lodging = LODGING_LEVELS.find((level) => level === input.lodging);

  if (errors.length > 0) return { errors };
  const stated = Array.isArray(input.assumptions)
    ? input.assumptions
        .map((entry) => shortText(entry, 150))
        .filter((entry): entry is string => entry !== undefined)
        .slice(0, MAX_ASSUMPTIONS)
    : [];
  return {
    brief: {
      destination: destination!,
      ...(origin && { origin }),
      startDate: startDate as string,
      endDate: endDate as string,
      datesAssumed: input.datesAssumed === true,
      travelers,
      ...(budget && { budget }),
      preferences,
      ...(lodging && { lodging }),
      assumptions:
        stated.length > 0
          ? stated
          : defaultAssumptions(preferences, budget !== undefined),
    },
  };
}

// Liefert das Modell keine Annahmen, nennt der Code wenigstens die, die er
// selbst kennt: ohne Vorlieben ein gemischtes Programm, ohne Budget
// mittlere Preise (der Budget-Agent rechnet ohne Hostels).
function defaultAssumptions(
  preferences: string[],
  hasBudget: boolean,
): string[] {
  return [
    ...(preferences.length === 0
      ? [
          'Keine Vorlieben genannt: gemischtes Programm aus Sehenswürdigkeiten, Kultur und Essen',
        ]
      : []),
    ...(hasBudget ? [] : ['Kein Budget genannt: mittleres Preisniveau']),
  ];
}

// Prüft einen Entwurf: dieselben Regeln wie beim Speichern
// (itineraryValidationErrors) plus die, die ein vollständiger Tagesplan
// zusätzlich erfüllen muss.
export function tripDraftErrors(draft: TripDraft): string[] {
  const errors = itineraryValidationErrors(draft);
  if (errors.length > 0) return errors;
  const days = tripDays(draft);
  if (draft.stops.length === 0) {
    return ['stops darf nicht leer sein'];
  }
  for (const [index, stop] of draft.stops.entries()) {
    if (stop.dayNumber > days) {
      errors.push(
        `stops.${index}.dayNumber ${stop.dayNumber} liegt nach dem letzten Reisetag ${days}`,
      );
    }
    if (stop.lat === undefined || stop.lng === undefined) {
      errors.push(`stops.${index} hat keine Koordinaten`);
    }
  }
  for (let day = 1; day <= days; day++) {
    if (!draft.stops.some((stop) => stop.dayNumber === day)) {
      errors.push(`Tag ${day} hat keine Programmpunkte`);
    }
  }
  return errors;
}

// Was die Recherche für Planer und Budget zusammenträgt: nur Kennzahlen,
// damit der Prompt des Planers kurz bleibt (Plan 6.1, Punkt 4).
export interface ResearchFindings {
  // Geokodiert (Open-Meteo), aus dem ersten Tool, das den Ort kannte
  destination?: GlobeFocus;
  origin?: GlobeFocus;
  weather?: ToolWeather;
  lodging?: {
    priceBasis?: string;
    searchLinks: ToolLodging['searchLinks'];
    items: ToolLodging['items'];
  };
  transport?: {
    straightLineKm: number;
    recommended: TransportMode;
    options: TransportOption[];
  };
  knowledge: { title: string; source: string; content: string }[];
  sources: ChatSource[];
  searchAttempted: boolean;
  // Budget in Euro-Cent, falls es in einer anderen Währung genannt und über
  // convert_currency umgerechnet wurde
  budgetEurCents?: number;
}

export function emptyFindings(): ResearchFindings {
  return { knowledge: [], sources: [], searchAttempted: false };
}

function shortText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed.slice(0, max);
}

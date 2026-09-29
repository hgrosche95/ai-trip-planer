import type { TaskType } from '../runs/run-events';
import { priceLevelFor } from '../tools/lodging.tool';
import { parseTripBrief, tripDays, tripNights } from './trip-draft';
import type {
  DraftStop,
  LodgingLevel,
  ResearchFindings,
  TripBrief,
} from './trip-draft';

// Überarbeitung eines bestehenden Entwurfs per Folgenachricht ("Tag 2
// entspannter", "günstiger übernachten"). Das Modell sagt in der triage
// nur, WAS sich ändert (betroffene Tage, geänderte Eckdaten, eine kurze
// Beschreibung); was daraus folgt, entscheidet Code:
//
//   geänderte Eckdaten → welche Recherche neu läuft (revisionResearch)
//   andere Reisedauer  → ganzer Tagesplan neu (compose statt revise)
//   anderes Ziel       → neue Reise, voller Ablauf
//   betroffene Tage    → nur diese schreibt der Planer neu (revise),
//                        alle anderen bleiben Stop für Stop gleich

export interface DraftRevision {
  // Reisetage, deren Programm der Planer neu schreibt. [] = Programm bleibt,
  // es ändern sich nur Eckdaten (Unterkunft, Budget, Personen).
  days: number[];
  // Recherche-Aufgaben, die wegen geänderter Eckdaten neu laufen
  research: TaskType[];
  // Die Reisedauer hat sich geändert: Tage kommen dazu oder fallen weg,
  // dann schreibt compose den ganzen Plan neu (mit der alten Recherche,
  // soweit sie noch gilt).
  recompose: boolean;
  // Kurz, für "Geändert: …" am Anfang der Antwort
  summary: string;
}

export type RevisionResult =
  | { kind: 'new'; brief: TripBrief }
  | { kind: 'revise'; brief: TripBrief; revision: DraftRevision }
  | { errors: string[] };

// Felder des TripBrief, die eine Folgenachricht ändern darf. destination
// gehört dazu, macht aber eine neue Reise daraus.
const REVISABLE_FIELDS = [
  'destination',
  'origin',
  'startDate',
  'endDate',
  'datesAssumed',
  'travelers',
  'budget',
  'preferences',
  'lodging',
] as const;
type RevisableField = (typeof REVISABLE_FIELDS)[number];

// Annahmen, die mit einer ausdrücklichen Angabe nicht mehr gelten:
// "Unterkunft: Mittelklasse" nach "günstiger übernachten" usw.
const STALE_ASSUMPTIONS: Partial<Record<RevisableField, RegExp>> = {
  lodging: /unterkunft|hotel|übernacht/i,
  travelers: /person|reisende/i,
  budget: /budget|preisniveau/i,
  preferences: /vorliebe|interesse|programm/i,
};

// Reihenfolge wie in buildTaskPlan
const RESEARCH_ORDER: TaskType[] = [
  'research:weather',
  'research:lodging',
  'research:transport',
  'research:knowledge',
  'research:holidays',
  'research:currency',
];

const MAX_SUMMARY_CHARS = 120;

// Prüft die Überarbeitung aus der triage gegen den bestehenden Brief. `raw`
// ist { days, changes, summary } aus der Modellantwort.
export function parseRevision(
  raw: unknown,
  current: TripBrief,
  today: string,
): RevisionResult {
  const input = (raw ?? {}) as Record<string, unknown>;
  const changes = (
    input.changes && typeof input.changes === 'object' ? input.changes : {}
  ) as Record<string, unknown>;

  const merged: Record<string, unknown> = { ...current };
  const changed: RevisableField[] = [];
  for (const field of REVISABLE_FIELDS) {
    if (!(field in changes)) continue;
    // null heißt "nicht mehr" (z. B. kein Budget), undefined übernimmt
    // parseTripBrief dann als "nicht genannt"
    merged[field] = changes[field] ?? undefined;
    changed.push(field);
  }
  const parsed = parseTripBrief(merged, today);
  if ('errors' in parsed) return parsed;
  const next = parsed.brief;

  if (normalize(next.destination) !== normalize(current.destination)) {
    // Anderes Ziel: neue Reise. Die übrigen Eckdaten (Daten, Budget,
    // Personen) gelten weiter, die Annahmen fängt die neue Planung neu an.
    return { kind: 'new', brief: next };
  }

  const stale = changed
    .map((field) => STALE_ASSUMPTIONS[field])
    .filter((pattern): pattern is RegExp => pattern !== undefined);
  next.assumptions = current.assumptions.filter(
    (assumption) => !stale.some((pattern) => pattern.test(assumption)),
  );

  const days = revisedDays(input.days, tripDays(next));
  return {
    kind: 'revise',
    brief: next,
    revision: {
      days,
      research: revisionResearch(current, next),
      recompose: tripDays(current) !== tripDays(next),
      summary:
        cleanSummary(input.summary) ?? changeSummary(current, next, days),
    },
  };
}

// Welche Recherche eine Änderung auslöst. Alles andere (Programm, Tempo,
// Vorlieben, Gesamtbudget in Euro) braucht keine neue Recherche.
//
//   Daten           → Wetter + Feiertage + Unterkünfte (Zeitraum der Suche)
//   Personen        → Unterkünfte (Zimmer, Such-Links)
//   Unterkunftsniveau → Unterkünfte (Preisgrenze pro Nacht)
//   Abreiseort      → Anreise
//   Budget in fremder Währung → Umrechnung
export function revisionResearch(
  current: TripBrief,
  next: TripBrief,
): TaskType[] {
  const tasks = new Set<TaskType>();
  const hasNights = tripNights(next) > 0;
  if (
    current.startDate !== next.startDate ||
    current.endDate !== next.endDate
  ) {
    tasks.add('research:weather');
    tasks.add('research:holidays');
    if (hasNights) tasks.add('research:lodging');
  }
  if (
    hasNights &&
    (current.travelers !== next.travelers || current.lodging !== next.lodging)
  ) {
    tasks.add('research:lodging');
  }
  if (next.origin && next.origin !== current.origin) {
    tasks.add('research:transport');
  }
  if (
    next.budget &&
    next.budget.currency !== 'EUR' &&
    (next.budget.currency !== current.budget?.currency ||
      next.budget.amount !== current.budget?.amount)
  ) {
    tasks.add('research:currency');
  }
  return RESEARCH_ORDER.filter((task) => tasks.has(task));
}

// Übernimmt aus der neuen Recherche genau die Teile, die neu gelaufen sind.
// Ist eine Aufgabe fehlgeschlagen, fehlt ihr Teil danach: Die alten Werte
// gehörten zu anderen Eckdaten (anderer Zeitraum, andere Preisgrenze).
export function mergeFindings(
  base: ResearchFindings,
  fresh: ResearchFindings,
  tasks: TaskType[],
): ResearchFindings {
  const merged: ResearchFindings = {
    ...base,
    destination: base.destination ?? fresh.destination,
  };
  for (const task of tasks) {
    switch (task) {
      case 'research:weather':
        merged.weather = fresh.weather;
        break;
      case 'research:lodging':
        merged.lodging = fresh.lodging;
        break;
      case 'research:transport':
        merged.transport = fresh.transport;
        merged.origin = fresh.origin;
        break;
      case 'research:knowledge':
        merged.knowledge = fresh.knowledge;
        merged.sources = fresh.sources;
        merged.searchAttempted = fresh.searchAttempted;
        break;
      case 'research:currency':
        merged.budgetEurCents = fresh.budgetEurCents;
        break;
      case 'research:holidays':
        merged.holidays = fresh.holidays;
        break;
    }
  }
  return merged;
}

// Ersetzt die Programmpunkte der überarbeiteten Tage. Alle anderen Stops
// bleiben dieselben Objekte in derselben Reihenfolge.
export function replaceDays(
  stops: DraftStop[],
  days: number[],
  revised: DraftStop[],
): DraftStop[] {
  return [
    ...stops.filter((stop) => !days.includes(stop.dayNumber)),
    ...revised,
  ].sort((a, b) => a.dayNumber - b.dayNumber || a.order - b.order);
}

// Preisgrenze pro Nacht für die Unterkunftssuche: "günstig" heißt unter
// dem unteren Ende eines Mittelklasse-Hotels der Stadt (Pension, einfaches
// Hotel). Ohne Angabe oder bei "gehoben" gibt es keine Grenze.
export function lodgingNightCapEur(
  brief: Pick<TripBrief, 'destination' | 'lodging'>,
): number | undefined {
  if (brief.lodging !== 'budget') return undefined;
  const [min] = priceLevelFor(brief.destination).level.hotelNightEur;
  return Math.round(min * 0.8);
}

export const LODGING_LABELS: Record<LodgingLevel, string> = {
  budget: 'günstig',
  mid: 'Mittelklasse',
  upscale: 'gehoben',
};

// Beschreibung der Änderung aus Code, falls das Modell keine liefert
export function changeSummary(
  current: TripBrief,
  next: TripBrief,
  days: number[],
): string {
  const parts: string[] = [];
  if (days.length > 0) {
    parts.push(
      `${days.length === 1 ? 'Tag' : 'Tage'} ${days.join(', ')} angepasst`,
    );
  }
  if (
    current.startDate !== next.startDate ||
    current.endDate !== next.endDate
  ) {
    parts.push(`neuer Zeitraum ${next.startDate} bis ${next.endDate}`);
  }
  if (current.lodging !== next.lodging && next.lodging) {
    parts.push(`Unterkunft ${LODGING_LABELS[next.lodging]}`);
  }
  if (current.travelers !== next.travelers) {
    parts.push(
      `${next.travelers} ${next.travelers === 1 ? 'Person' : 'Personen'}`,
    );
  }
  if (
    current.budget?.amount !== next.budget?.amount ||
    current.budget?.currency !== next.budget?.currency
  ) {
    parts.push(
      next.budget
        ? `Budget ${next.budget.amount} ${next.budget.currency}`
        : 'ohne Budget',
    );
  }
  if (current.origin !== next.origin && next.origin) {
    parts.push(`Anreise ab ${next.origin}`);
  }
  if (current.preferences.join('|') !== next.preferences.join('|')) {
    parts.push('Vorlieben angepasst');
  }
  return parts.length > 0 ? parts.join(', ') : 'Entwurf angepasst';
}

function revisedDays(raw: unknown, days: number): number[] {
  if (!Array.isArray(raw)) return [];
  const valid = raw.filter(
    (day): day is number =>
      typeof day === 'number' &&
      Number.isInteger(day) &&
      day >= 1 &&
      day <= days,
  );
  return [...new Set(valid)].sort((a, b) => a - b);
}

// Eine Zeile Klartext: Die Beschreibung landet in der Antwort und im
// Ereignis itinerary.draft, nicht als Markdown-Block.
function cleanSummary(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const line = value
    .replace(/[\r\n]+/g, ' ')
    .replace(/[*_`#<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return line === '' ? undefined : line.slice(0, MAX_SUMMARY_CHARS);
}

function normalize(name: string): string {
  return name.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

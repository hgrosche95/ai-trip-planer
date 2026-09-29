import type { DraftStop } from '../trip-draft';

// Die strukturierten Ausgaben des Planers. Das Modell bekommt die Form als
// kurzes Beispiel im Prompt (billiger als ein ausführliches JSON-Schema),
// der Code prüft jede Antwort, bevor sie weiterverwendet wird.

export const TRIAGE_OUTPUT_EXAMPLE = `{"status":"ready","destination":"Lissabon","origin":"Berlin","startDate":"2026-10-14","endDate":"2026-10-16","datesAssumed":true,"travelers":1,"budget":{"amount":800,"currency":"EUR"},"preferences":["Kultur"],"assumptions":["1 Person","Unterkunft: Mittelklasse-Hotel"]}`;
export const TRIAGE_ASK_EXAMPLE = `{"status":"ask","question":"..."}`;

export const STOP_CATEGORIES = [
  'FOOD',
  'CULTURE',
  'SIGHTSEEING',
  'ACCOMMODATION',
  'TRANSPORT',
  'OTHER',
] as const;

export const COMPOSE_OUTPUT_EXAMPLE = `{"stops":[{"dayNumber":1,"order":1,"title":"...","description":"...","category":"${STOP_CATEGORIES.join('|')}","costCents":0,"lat":38.71,"lng":-9.13}]}`;

export type TriageOutput =
  { status: 'ask'; question?: string } | { status: 'ready'; brief: unknown };

export class PlannerOutputError extends Error {
  constructor(
    message: string,
    readonly errors: string[],
  ) {
    super(message);
    this.name = 'PlannerOutputError';
  }
}

// Holt das JSON-Objekt aus einer Modellantwort. Modelle umrahmen es gern
// mit ```json … ``` oder einem Satz davor, trotz anderslautender Anweisung.
export function extractJson(text: string | null): unknown {
  if (!text) throw new SyntaxError('leere Antwort');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new SyntaxError('kein JSON-Objekt gefunden');
  }
  return JSON.parse(text.slice(start, end + 1));
}

export function parseTriageOutput(text: string | null): TriageOutput {
  const raw = extractJson(text) as Record<string, unknown>;
  if (raw.status === 'ready') return { status: 'ready', brief: raw };
  const question =
    typeof raw.question === 'string' && raw.question.trim() !== ''
      ? raw.question.trim().slice(0, 500)
      : undefined;
  return { status: 'ask', question };
}

// Programmpunkte aus der compose-Antwort. Nur die bekannten Felder werden
// übernommen, geprüft wird danach mit tripDraftErrors(). Fehler hier (kein
// JSON, keine Liste) gehen als Text an den Reparaturversuch.
export function parseComposeOutput(text: string | null): DraftStop[] {
  const raw = extractJson(text) as { stops?: unknown };
  if (!Array.isArray(raw.stops)) {
    throw new SyntaxError('stops fehlt oder ist keine Liste');
  }
  return raw.stops.map((entry: Record<string, unknown>) => {
    const stop: Record<string, unknown> = {
      dayNumber: entry?.dayNumber,
      order: entry?.order,
      title: entry?.title,
      category: entry?.category,
    };
    for (const key of ['description', 'costCents', 'lat', 'lng']) {
      if (entry?.[key] !== undefined && entry[key] !== null) {
        stop[key] = entry[key];
      }
    }
    return stop as unknown as DraftStop;
  });
}

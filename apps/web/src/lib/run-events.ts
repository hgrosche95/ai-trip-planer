// Spiegel von apps/api/src/runs/run-events.ts: die Ereignisse, die
// POST /agent/runs live schickt. Ändert sich dort etwas, muss es hier mit.
// (Später wandern beide in ein gemeinsames Paket packages/agent-events.)

export interface GlobePoint {
  name: string;
  lat: number;
  lng: number;
}

export interface ChatSource {
  title: string;
  source: string;
  license: string;
  url: string | null;
  score: number;
}

// Wetter eines Tages, wie get_weather es liefert (code = WMO-Wettercode)
export interface WeatherDay {
  date: string;
  tMin: number;
  tMax: number;
  precipMm: number;
  code: number;
  label: string;
}

export interface WeatherReport {
  place: GlobePoint;
  // forecast = echte Vorhersage, climate = Vorjahreswerte als Anhaltspunkt
  source: 'forecast' | 'climate';
  days: WeatherDay[];
}

export type LodgingKind = 'hotel' | 'hostel' | 'guest_house' | 'apartment';

// Eine echte Unterkunft aus OpenStreetMap. Der Preis ist eine Schätzung aus
// dem Preisniveau der Stadt, kein Angebot.
export interface LodgingItem {
  name: string;
  lat: number;
  lng: number;
  kind: LodgingKind;
  priceMinEur: number;
  priceMaxEur: number;
}

export interface LodgingReport {
  place: GlobePoint;
  // Suche auf Booking.com und Airbnb mit Ort, Daten und Personenzahl. Optional,
  // weil ältere gespeicherte Läufe (Replay) sie noch nicht enthalten.
  searchLinks?: { booking: string; airbnb: string };
  items: LodgingItem[];
}

export interface RunTotals {
  llmCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
}

export interface RunEventPayloads {
  // runId = Schlüssel des gespeicherten Laufs, für /replay?run=<runId>
  'run.started': { runId: string };
  'llm.started': { stepId: string };
  // Der laufende LLM-Aufruf wartet auf das Groq-Limit (Minutenbudget an
  // Tokens bzw. freie Anfragen), bevor er rausgeht
  'llm.throttled': { stepId: string; waitMs: number; reason: 'tokens' | 'requests' };
  'llm.call': {
    stepId: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    costUsd: number | null;
    finishReason: string;
  };
  'tool.started': { stepId: string; tool: string };
  'tool.finished': {
    stepId: string;
    tool: string;
    kind: 'tool' | 'retriever';
    latencyMs: number;
    ok: boolean;
    hits?: number;
    // true, wenn das Ergebnis aus dem Cache externer APIs kam
    cached?: boolean;
  };
  'place.added': GlobePoint & { kind: 'destination' | 'origin' };
  'route.added': { from: GlobePoint; to: GlobePoint };
  // Wetter pro Reisetag, sobald get_weather lief
  'weather.updated': WeatherReport;
  // Unterkünfte mit geschätzter Preisspanne, sobald search_lodging lief
  'lodging.updated': LodgingReport;
  // Stationen in Reihenfolge (gespeicherter Plan oder Rundreise), kommt am
  // Ende des Laufs; der Globus verbindet sie mit Bögen
  'stops.updated': { stops: GlobePoint[] };
  sources: { sources: ChatSource[]; searchAttempted: boolean };
  'message.completed': { text: string };
  'run.finished': { totals: RunTotals };
  'run.error': {
    code: 'rate_limited' | 'quota_exhausted' | 'internal';
    message: string;
  };
}

export type RunEventType = keyof RunEventPayloads;

export type RunEvent = {
  [T in RunEventType]: {
    type: T;
    seq: number;
    elapsedMs: number;
    data: RunEventPayloads[T];
  };
}[RunEventType];

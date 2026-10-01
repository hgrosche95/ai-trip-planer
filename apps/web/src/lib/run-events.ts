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

// Wer einen Schritt ausführt. Classic-Läufe haben kein agent-Feld, im
// Multi-Agenten-Modus ordnet es LLM-Aufrufe und Tools einer Lane zu.
export type AgentName = 'orchestrator' | 'planner' | 'research' | 'budget' | 'critic';
export type AgentMode = 'classic' | 'multi';

export type TaskType =
  | 'triage'
  | 'plan'
  | 'research:weather'
  | 'research:lodging'
  | 'research:transport'
  | 'research:knowledge'
  | 'research:currency'
  | 'research:holidays'
  | 'compose'
  // Überarbeitung einzelner Tage eines bestehenden Entwurfs
  | 'revise'
  | 'budget'
  // Prüfung des Entwurfs durch den Kritiker
  | 'critique'
  // Nachbesserung der beanstandeten Tage
  | 'repair'
  | 'final';
export type TaskStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error';

export interface PlanTask {
  id: string;
  type: TaskType;
  agent: AgentName;
  dependsOn: string[];
  status: TaskStatus;
}

export type StopCategory =
  | 'FOOD'
  | 'CULTURE'
  | 'SIGHTSEEING'
  | 'ACCOMMODATION'
  | 'TRANSPORT'
  | 'OTHER';

// Entwurf eines Reiseplans (Multi-Agenten-Modus), genau im Format von
// POST /itineraries. Gespeichert wird er erst per "Plan speichern".
export interface ItineraryDraft {
  destination: string;
  startDate: string;
  endDate: string;
  budgetCents: number;
  currency: string;
  preferences: string[];
  // Eckdaten aus dem Brief, gehen beim Speichern mit ("Im Chat bearbeiten")
  travelers?: number;
  origin?: string;
  lodging?: 'budget' | 'mid' | 'upscale';
  stops: {
    dayNumber: number;
    order: number;
    title: string;
    description?: string;
    category?: StopCategory;
    costCents?: number;
    lat?: number;
    lng?: number;
  }[];
}

// Ein Befund des Kritikers. error: Der Planer bessert den Tag nach,
// warning: nur ein Hinweis. lat/lng: Ort für den Ring auf dem Globus.
export interface Violation {
  ruleId: string;
  severity: 'error' | 'warning';
  dayNumber?: number;
  stopTitle?: string;
  lat?: number;
  lng?: number;
  message: string;
}

// Was eine Nachbesserung an einem Tag geändert hat
export interface DayChange {
  dayNumber: number;
  removed: string[];
  added: string[];
}

export interface BudgetItem {
  category: 'transport' | 'lodging' | 'activities' | 'food';
  cents: number;
}

// Budgetbericht: limitCents null = kein Budget genannt, status dann 'ok'
export interface BudgetReport {
  currency: 'EUR';
  limitCents: number | null;
  totalCents: number;
  status: 'ok' | 'tight' | 'over';
  items: BudgetItem[];
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
  // mode fehlt in Läufen vor Phase 3 (Replay), dort ist es 'classic'
  'run.started': { runId: string; mode?: AgentMode };
  // Ein Agent beginnt bzw. beendet eine Aufgabe (nur Multi-Agenten-Modus)
  'agent.started': { stepId: string; agent: AgentName; task: TaskType };
  'agent.finished': {
    stepId: string;
    agent: AgentName;
    task: TaskType;
    status: 'ok' | 'error' | 'skipped';
    durationMs: number;
    summary: string;
  };
  // Aufgabenliste des Planers, bei jeder Änderung vollständig
  'plan.updated': { tasks: PlanTask[] };
  'budget.updated': BudgetReport;
  // Prüfung durch den Kritiker. round 0 = erster Entwurf, n = nach der
  // n-ten Nachbesserung; changes (ab round 1): Diff pro Tag; final: Es
  // folgt keine Nachbesserung mehr
  critique: {
    round: number;
    violations: Violation[];
    changes?: DayChange[];
    final: boolean;
  };
  // Fertiger, geprüfter Plan als Entwurf, dazu die Annahmen des Planers.
  // revision: Fassung in der Session (1 = erster Plan, jede Überarbeitung
  // per Folgenachricht +1; fehlt in älteren Läufen), change: kurze
  // Beschreibung der Änderung, nur bei einer Überarbeitung
  'itinerary.draft': {
    itinerary: ItineraryDraft;
    assumptions: string[];
    revision?: number;
    change?: string;
    // Überarbeitung einer gespeicherten Reise: Speichern ersetzt diese
    itineraryId?: string;
  };
  'llm.started': { stepId: string; agent?: AgentName; parentStepId?: string };
  // Der laufende LLM-Aufruf wartet auf das Groq-Limit (Minutenbudget an
  // Tokens bzw. freie Anfragen), bevor er rausgeht
  'llm.throttled': {
    stepId: string;
    agent?: AgentName;
    waitMs: number;
    reason: 'tokens' | 'requests';
  };
  'llm.call': {
    stepId: string;
    agent?: AgentName;
    model: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    costUsd: number | null;
    finishReason: string;
  };
  'tool.started': { stepId: string; tool: string; agent?: AgentName; parentStepId?: string };
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

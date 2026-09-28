import type {
  ChatSource,
  GlobePoint,
  LodgingReport,
  RunEvent,
  RunTotals,
  WeatherReport,
} from './run-events';

// Eine Zeile in der Timeline: ein LLM-Aufruf oder ein Tool
export interface TraceStep {
  id: string;
  kind: 'llm' | 'tool' | 'retriever';
  // Tool-Name bzw. Modell, sobald bekannt
  name: string;
  status: 'running' | 'done' | 'error';
  // Zeitpunkt des Starts seit Laufbeginn, für die Wasserfall-Darstellung
  startedMs: number;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number | null;
  hits?: number;
  // Ergebnis kam aus dem Cache externer APIs (erklärt eine sehr kurze Laufzeit)
  cached?: boolean;
  // Wartezeit auf das Groq-Limit vor diesem LLM-Aufruf (in latencyMs enthalten)
  throttledMs?: number;
}

export interface RunState {
  status: 'running' | 'done' | 'error';
  // ID des gespeicherten Laufs aus run.started, für den Link nach /replay
  runId?: string;
  steps: TraceStep[];
  places: (GlobePoint & { kind: 'destination' | 'origin' })[];
  routes: { from: GlobePoint; to: GlobePoint }[];
  // Stationen eines gespeicherten Plans oder einer Rundreise
  stops: GlobePoint[];
  // Wetter pro Ort, in der Reihenfolge der ersten Meldung
  weather: WeatherReport[];
  // Unterkünfte pro Ort, wie beim Wetter
  lodging: LodgingReport[];
  sources: ChatSource[];
  searchAttempted: boolean;
  reply?: string;
  totals?: RunTotals;
  error?: string;
}

export function initialRunState(): RunState {
  return {
    status: 'running',
    steps: [],
    places: [],
    routes: [],
    stops: [],
    weather: [],
    lodging: [],
    sources: [],
    searchAttempted: false,
  };
}

// Reiner Reducer: aus altem Zustand + Ereignis wird ein neuer Zustand.
// Kein fetch, kein React - dadurch ohne Browser testbar (run-state.test.ts)
// und später auch für das Abspielen gespeicherter Läufe nutzbar.
export function applyRunEvent(state: RunState, event: RunEvent): RunState {
  switch (event.type) {
    case 'run.started':
      return { ...state, runId: event.data.runId };
    case 'llm.started':
      return addStep(state, {
        id: event.data.stepId,
        kind: 'llm',
        name: 'KI denkt nach',
        status: 'running',
        startedMs: event.elapsedMs,
      });
    case 'llm.throttled': {
      // Wartet derselbe Schritt mehrmals (z. B. erneut nach einem 429),
      // zählen die Wartezeiten zusammen
      const step = state.steps.find((entry) => entry.id === event.data.stepId);
      return updateStep(state, event.data.stepId, {
        throttledMs: (step?.throttledMs ?? 0) + event.data.waitMs,
      });
    }
    case 'llm.call':
      return updateStep(state, event.data.stepId, {
        name: event.data.model,
        status: 'done',
        latencyMs: event.data.latencyMs,
        inputTokens: event.data.inputTokens,
        outputTokens: event.data.outputTokens,
        costUsd: event.data.costUsd,
      });
    case 'tool.started':
      return addStep(state, {
        id: event.data.stepId,
        kind: 'tool',
        name: event.data.tool,
        status: 'running',
        startedMs: event.elapsedMs,
      });
    case 'tool.finished':
      return updateStep(state, event.data.stepId, {
        kind: event.data.kind,
        status: event.data.ok ? 'done' : 'error',
        latencyMs: event.data.latencyMs,
        hits: event.data.hits,
        cached: event.data.cached,
      });
    case 'place.added':
      // Derselbe Ort kann mehrfach kommen (z. B. erneuter Aufruf mit Abreiseort)
      return state.places.some((place) => place.name === event.data.name)
        ? state
        : { ...state, places: [...state.places, event.data] };
    case 'route.added':
      return { ...state, routes: [...state.routes, event.data] };
    case 'weather.updated':
      // Fragt der Agent denselben Ort erneut ab (z. B. mit anderen Daten),
      // ersetzt der neue Bericht den alten an seiner Stelle
      return { ...state, weather: upsertByPlace(state.weather, event.data) };
    case 'lodging.updated':
      return { ...state, lodging: upsertByPlace(state.lodging, event.data) };
    case 'stops.updated':
      return { ...state, stops: event.data.stops };
    case 'sources':
      return {
        ...state,
        sources: event.data.sources,
        searchAttempted: event.data.searchAttempted,
      };
    case 'message.completed':
      return { ...state, reply: event.data.text };
    case 'run.finished':
      return { ...state, status: 'done', totals: event.data.totals };
    case 'run.error':
      return { ...state, status: 'error', error: event.data.message };
    default:
      return state;
  }
}

function upsertByPlace<T extends { place: GlobePoint }>(reports: T[], report: T): T[] {
  const name = report.place.name;
  return reports.some((entry) => entry.place.name === name)
    ? reports.map((entry) => (entry.place.name === name ? report : entry))
    : [...reports, report];
}

function addStep(state: RunState, step: TraceStep): RunState {
  return { ...state, steps: [...state.steps, step] };
}

function updateStep(state: RunState, id: string, changes: Partial<TraceStep>): RunState {
  return {
    ...state,
    steps: state.steps.map((step) => (step.id === id ? { ...step, ...changes } : step)),
  };
}

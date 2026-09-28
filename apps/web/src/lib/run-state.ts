import type {
  ChatSource,
  GlobePoint,
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
}

export interface RunState {
  status: 'running' | 'done' | 'error';
  steps: TraceStep[];
  places: (GlobePoint & { kind: 'destination' | 'origin' })[];
  routes: { from: GlobePoint; to: GlobePoint }[];
  // Stationen eines gespeicherten Plans oder einer Rundreise
  stops: GlobePoint[];
  // Wetter pro Ort, in der Reihenfolge der ersten Meldung
  weather: WeatherReport[];
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
    sources: [],
    searchAttempted: false,
  };
}

// Reiner Reducer: aus altem Zustand + Ereignis wird ein neuer Zustand.
// Kein fetch, kein React - dadurch ohne Browser testbar (run-state.test.ts)
// und später auch für das Abspielen gespeicherter Läufe nutzbar.
export function applyRunEvent(state: RunState, event: RunEvent): RunState {
  switch (event.type) {
    case 'llm.started':
      return addStep(state, {
        id: event.data.stepId,
        kind: 'llm',
        name: 'KI denkt nach',
        status: 'running',
        startedMs: event.elapsedMs,
      });
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
    case 'weather.updated': {
      // Fragt der Agent denselben Ort erneut ab (z. B. mit anderen Daten),
      // ersetzt der neue Bericht den alten an seiner Stelle
      const name = event.data.place.name;
      const exists = state.weather.some((report) => report.place.name === name);
      return {
        ...state,
        weather: exists
          ? state.weather.map((report) => (report.place.name === name ? event.data : report))
          : [...state.weather, event.data],
      };
    }
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

function addStep(state: RunState, step: TraceStep): RunState {
  return { ...state, steps: [...state.steps, step] };
}

function updateStep(state: RunState, id: string, changes: Partial<TraceStep>): RunState {
  return {
    ...state,
    steps: state.steps.map((step) => (step.id === id ? { ...step, ...changes } : step)),
  };
}

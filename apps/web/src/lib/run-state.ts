import type {
  AgentMode,
  AgentName,
  BudgetReport,
  ChatSource,
  DayChange,
  GlobePoint,
  ItineraryDraft,
  LodgingReport,
  PlanTask,
  RunEvent,
  RunTotals,
  TaskType,
  Violation,
  WeatherReport,
} from './run-events';

// Eine Prüfrunde des Kritikers (critique-Ereignis)
export interface CritiqueRound {
  round: number;
  violations: Violation[];
  changes: DayChange[];
  final: boolean;
}

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
  // Nur im Multi-Agenten-Modus: welcher Agent, in welchem Agenten-Schritt
  agent?: AgentName;
  parentStepId?: string;
}

// Eine Aufgabe eines Agenten (agent.started/agent.finished), ein Balken in
// seiner Lane im Trace-Panel
export interface AgentStep {
  id: string;
  agent: AgentName;
  task: TaskType;
  status: 'running' | 'done' | 'error' | 'skipped';
  startedMs: number;
  durationMs?: number;
  summary?: string;
}

export interface RunState {
  status: 'running' | 'done' | 'error';
  // ID des gespeicherten Laufs aus run.started, für den Link nach /replay
  runId?: string;
  // Fehlt bei Läufen vor Phase 3, die sind classic
  mode?: AgentMode;
  steps: TraceStep[];
  // Multi-Agenten-Modus: Schritte der Agenten, Aufgabenliste, Budget
  agentSteps: AgentStep[];
  tasks: PlanTask[];
  budget?: BudgetReport;
  // Prüfrunden des Kritikers in Reihenfolge: die erste am ersten Entwurf,
  // jede weitere nach einer Nachbesserung
  critiques: CritiqueRound[];
  // Entwurf des Plans (Multi-Modus), noch nicht gespeichert: Der Chat zeigt
  // dafür "Plan speichern" (nur beim neuesten, siehe draft-versions.ts).
  // revision: Fassung in der Session, 1 bei älteren Läufen ohne Angabe;
  // change: was eine Überarbeitung geändert hat
  draft?: {
    itinerary: ItineraryDraft;
    assumptions: string[];
    revision: number;
    change?: string;
  };
  // Spätester Zeitpunkt aller Ereignisse bisher: Ende laufender Balken im
  // Wasserfall (live wie im Replay, ohne Uhr im Browser)
  lastMs: number;
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
    agentSteps: [],
    tasks: [],
    critiques: [],
    lastMs: 0,
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
  const next = reduce(state, event);
  return event.elapsedMs > next.lastMs ? { ...next, lastMs: event.elapsedMs } : next;
}

function reduce(state: RunState, event: RunEvent): RunState {
  switch (event.type) {
    case 'run.started':
      return { ...state, runId: event.data.runId, mode: event.data.mode ?? 'classic' };
    case 'agent.started':
      return {
        ...state,
        agentSteps: [
          ...state.agentSteps,
          {
            id: event.data.stepId,
            agent: event.data.agent,
            task: event.data.task,
            status: 'running',
            startedMs: event.elapsedMs,
          },
        ],
      };
    case 'agent.finished': {
      const { stepId, status, durationMs, summary } = event.data;
      return {
        ...state,
        agentSteps: state.agentSteps.map((step) =>
          step.id === stepId
            ? { ...step, status: status === 'ok' ? 'done' : status, durationMs, summary }
            : step,
        ),
      };
    }
    case 'plan.updated':
      return { ...state, tasks: event.data.tasks };
    case 'budget.updated':
      return { ...state, budget: event.data };
    case 'critique':
      return {
        ...state,
        critiques: [...state.critiques, { ...event.data, changes: event.data.changes ?? [] }],
      };
    case 'itinerary.draft':
      return { ...state, draft: { ...event.data, revision: event.data.revision ?? 1 } };
    case 'llm.started':
      return addStep(state, {
        id: event.data.stepId,
        kind: 'llm',
        name: 'KI denkt nach',
        status: 'running',
        startedMs: event.elapsedMs,
        ...origin(event.data),
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
        ...origin(event.data),
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

// agent und parentStepId nur übernehmen, wenn sie da sind: Classic-Schritte
// bleiben so unverändert
function origin(data: { agent?: AgentName; parentStepId?: string }) {
  return {
    ...(data.agent && { agent: data.agent }),
    ...(data.parentStepId && { parentStepId: data.parentStepId }),
  };
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

import type {
  ChatSource,
  GlobeFocus,
  ToolLodging,
  ToolWeather,
} from '../tools';

// Wer einen Schritt ausführt. Im Classic-Modus gibt es nur den einen Agenten,
// die Ereignisse tragen dann kein agent-Feld. Im Multi-Agenten-Modus
// (AGENT_MODE=multi, orchestrator/) ordnet das Feld jeden LLM-Aufruf und jedes
// Tool einer Lane im Trace-Panel zu. 'critic' folgt in Phase 4.
export type AgentName = 'orchestrator' | 'planner' | 'research' | 'budget';
export type AgentMode = 'classic' | 'multi';

// Aufgaben aus dem Plan des Planers (TaskPlan in orchestrator/trip-draft.ts)
export type TaskType =
  | 'triage'
  | 'plan'
  | 'research:weather'
  | 'research:lodging'
  | 'research:transport'
  | 'research:knowledge'
  | 'research:currency'
  | 'compose'
  | 'budget'
  | 'final';
export type TaskStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error';

export interface BudgetItem {
  category: 'transport' | 'lodging' | 'activities' | 'food';
  cents: number;
}

// Ereignisse, die ein Agentenlauf live an das Frontend schickt (POST
// /agent/runs, Server-Sent Events). Jedes Ereignis beschreibt nur die FORM
// des Laufs (welches Tool, wie lange, wie viele Tokens) - Nutzertext steckt
// ausschließlich in message.completed, das ohnehin nur der Nutzer selbst sieht.
// apps/web/src/lib/run-events.ts spiegelt diese Typen für das Frontend.
export interface RunEventPayloads {
  // runId = Schlüssel des gespeicherten Laufs, für /replay?run=<runId>
  // mode fehlt in Läufen vor Phase 3 (Replay), dort ist es 'classic'
  'run.started': { runId: string; mode?: AgentMode };
  // Ein Agent beginnt eine Aufgabe (nur Multi-Agenten-Modus). Mehrere
  // Recherche-Aufgaben laufen gleichzeitig, jede mit eigener stepId.
  'agent.started': { stepId: string; agent: AgentName; task: TaskType };
  // summary: kurze, strukturierte Zusammenfassung ("3 Tage, Vorhersage"),
  // nie Nutzerfreitext
  'agent.finished': {
    stepId: string;
    agent: AgentName;
    task: TaskType;
    status: 'ok' | 'error' | 'skipped';
    durationMs: number;
    summary: string;
  };
  // Aufgabenliste des Planers mit aktuellem Stand, bei jeder Änderung
  // vollständig (Checkliste im Frontend)
  'plan.updated': {
    tasks: {
      id: string;
      type: TaskType;
      agent: AgentName;
      dependsOn: string[];
      status: TaskStatus;
    }[];
  };
  // Ergebnis des Budget-Agenten. limitCents null: Der Nutzer hat kein Budget
  // genannt, dann ist status immer 'ok'.
  'budget.updated': {
    currency: 'EUR';
    limitCents: number | null;
    totalCents: number;
    status: 'ok' | 'tight' | 'over';
    items: BudgetItem[];
  };
  // LLM-Aufruf beginnt: das Frontend zeigt sofort eine laufende Zeile.
  // agent und parentStepId (Schritt aus agent.started) nur im Multi-Modus.
  'llm.started': { stepId: string; agent?: AgentName; parentStepId?: string };
  // Der Rate-Limiter hält den laufenden LLM-Aufruf an, weil das Minutenbudget
  // (tokens) bzw. die freien Anfragen (requests) bei Groq nicht reichen.
  // Kommt zwischen llm.started und llm.call; latencyMs in llm.call enthält
  // die Wartezeit.
  'llm.throttled': {
    stepId: string;
    agent?: AgentName;
    waitMs: number;
    reason: 'tokens' | 'requests';
  };
  // LLM-Aufruf ist fertig, mit allem, was die Timeline anzeigt
  'llm.call': {
    stepId: string;
    agent?: AgentName;
    model: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    // null, wenn für das Modell kein Preis hinterlegt ist (llm/pricing.ts)
    costUsd: number | null;
    finishReason: string;
  };
  'tool.started': {
    stepId: string;
    tool: string;
    agent?: AgentName;
    parentStepId?: string;
  };
  'tool.finished': {
    stepId: string;
    tool: string;
    kind: 'tool' | 'retriever';
    latencyMs: number;
    ok: boolean;
    // nur bei retriever: Anzahl gefundener Quellen
    hits?: number;
    // true, wenn das Ergebnis aus dem Cache externer APIs kam
    cached?: boolean;
  };
  'place.added': GlobeFocus & { kind: 'destination' | 'origin' };
  'route.added': { from: GlobeFocus; to: GlobeFocus };
  // Wetter pro Reisetag, sobald get_weather lief. source 'climate' heißt:
  // Vorjahreswerte, keine Vorhersage - das Frontend weist darauf hin.
  'weather.updated': ToolWeather;
  // Echte Unterkünfte (OpenStreetMap) mit GESCHÄTZTER Preisspanne pro
  // Nacht, sobald search_lodging lief. Ein neuer Bericht zum selben Ort
  // ersetzt den alten.
  'lodging.updated': ToolLodging;
  // Stationen in Reihenfolge (gespeicherter Plan oder Rundreise), kommt am
  // Ende des Laufs; der Globus verbindet sie mit Bögen
  'stops.updated': { stops: GlobeFocus[] };
  sources: { sources: ChatSource[]; searchAttempted: boolean };
  'message.completed': { text: string };
  'run.finished': { totals: RunTotals };
  'run.error': {
    code: 'rate_limited' | 'quota_exhausted' | 'internal';
    message: string;
  };
}

export type RunEventType = keyof RunEventPayloads;

export interface RunTotals {
  llmCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
}

// Umschlag, der um jedes Ereignis gelegt wird. `seq` ist streng monoton und
// macht die Reihenfolge eindeutig, `elapsedMs` ist die Zeit seit Laufbeginn
// (für die Timeline aussagekräftiger als eine Uhrzeit).
export type RunEvent = {
  [T in RunEventType]: {
    type: T;
    seq: number;
    elapsedMs: number;
    data: RunEventPayloads[T];
  };
}[RunEventType];

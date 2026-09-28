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

export interface RunTotals {
  llmCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
}

export interface RunEventPayloads {
  'run.started': Record<string, never>;
  'llm.started': { stepId: string };
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
  };
  'place.added': GlobePoint & { kind: 'destination' | 'origin' };
  'route.added': { from: GlobePoint; to: GlobePoint };
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

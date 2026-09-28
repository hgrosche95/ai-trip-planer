import type { ChatSource, GlobeFocus } from '../tools';

// Ereignisse, die ein Agentenlauf live an das Frontend schickt (POST
// /agent/runs, Server-Sent Events). Jedes Ereignis beschreibt nur die FORM
// des Laufs (welches Tool, wie lange, wie viele Tokens) - Nutzertext steckt
// ausschließlich in message.completed, das ohnehin nur der Nutzer selbst sieht.
// apps/web/src/lib/run-events.ts spiegelt diese Typen für das Frontend.
export interface RunEventPayloads {
  'run.started': Record<string, never>;
  // LLM-Aufruf beginnt: das Frontend zeigt sofort eine laufende Zeile
  'llm.started': { stepId: string };
  // LLM-Aufruf ist fertig, mit allem, was die Timeline anzeigt
  'llm.call': {
    stepId: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    // null, wenn für das Modell kein Preis hinterlegt ist (llm/pricing.ts)
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
    // nur bei retriever: Anzahl gefundener Quellen
    hits?: number;
  };
  'place.added': GlobeFocus & { kind: 'destination' | 'origin' };
  'route.added': { from: GlobeFocus; to: GlobeFocus };
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

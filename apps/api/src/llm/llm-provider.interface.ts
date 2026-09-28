export type LlmRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmToolResult {
  toolCallId: string;
  content: string;
}

export interface LlmMessage {
  role: LlmRole;
  content?: string;
  toolCalls?: LlmToolCall[];
  toolResults?: LlmToolResult[];
}

export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmChatOptions {
  model?: string;
  maxTokens: number;
  temperature?: number;
  // Wird aufgerufen, BEVOR ein Rate-Limiter vor dem Aufruf wartet. Die
  // Provider kennen den Ereignis-Emitter nicht; AgentService übersetzt das
  // in das Ereignis llm.throttled für die Timeline.
  onThrottle?: (waitMs: number, reason: 'tokens' | 'requests') => void;
}

export type LlmFinishReason = 'stop' | 'tool_calls' | 'length' | 'other';

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

// Rate-Limit-Stand des Anbieters nach einem Aufruf, aus den
// x-ratelimit-*-Headern (nur Groq liefert sie, Anthropic und Fake lassen das
// Feld weg). Reset-Angaben sind Dauern in ms ab Eingang der Antwort. Bei Groq
// zählen die Token-Werte pro Minute (TPM), die Request-Werte pro Tag (RPD).
export interface LlmRateLimit {
  remainingTokens?: number;
  resetTokensMs?: number;
  remainingRequests?: number;
  resetRequestsMs?: number;
}

export interface LlmChatResult {
  content: string | null;
  toolCalls: LlmToolCall[];
  finishReason: LlmFinishReason;
  usage: LlmUsage;
  model: string;
  rateLimit?: LlmRateLimit;
}

export interface LlmProvider {
  chat(
    messages: LlmMessage[],
    tools: LlmToolDefinition[],
    options: LlmChatOptions,
  ): Promise<LlmChatResult>;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

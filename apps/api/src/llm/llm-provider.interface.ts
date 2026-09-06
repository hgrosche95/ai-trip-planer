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
  model: string;
  maxTokens: number;
  temperature?: number;
}

export type LlmFinishReason = 'stop' | 'tool_calls' | 'length' | 'other';

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmChatResult {
  content: string | null;
  toolCalls: LlmToolCall[];
  finishReason: LlmFinishReason;
  usage: LlmUsage;
}

export interface LlmProvider {
  chat(
    messages: LlmMessage[],
    tools: LlmToolDefinition[],
    options: LlmChatOptions,
  ): Promise<LlmChatResult>;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

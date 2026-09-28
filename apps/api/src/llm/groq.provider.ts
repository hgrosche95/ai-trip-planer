import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import {
  LlmChatOptions,
  LlmChatResult,
  LlmFinishReason,
  LlmMessage,
  LlmProvider,
  LlmToolCall,
  LlmToolDefinition,
} from './llm-provider.interface';
import { parseRateLimitHeaders } from './rate-limit-headers';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

// Welches Modell ein Aufruf tatsächlich nutzt. Auch der Rate-Limiter braucht
// das schon VOR dem Aufruf, weil Groq die Limits pro Modell zählt.
export function resolveGroqModel(model?: string): string {
  return model ?? process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b';
}

@Injectable()
export class GroqProvider implements LlmProvider {
  private readonly client = new OpenAI({
    baseURL: GROQ_BASE_URL,
    apiKey: process.env.GROQ_API_KEY,
  });

  async chat(
    messages: LlmMessage[],
    tools: LlmToolDefinition[],
    options: LlmChatOptions,
  ): Promise<LlmChatResult> {
    const model = resolveGroqModel(options.model);

    // withResponse() liefert neben dem geparsten Ergebnis die rohe Antwort,
    // deren x-ratelimit-*-Header der TokenBudgetLimiter auswertet.
    const { data, response } = await this.client.chat.completions
      .create({
        model,
        max_completion_tokens: options.maxTokens,
        temperature: options.temperature,
        messages: messages.flatMap((m) => this.toOpenAiMessages(m)),
        tools: tools.length
          ? tools.map((tool) => this.toOpenAiTool(tool))
          : undefined,
      })
      .withResponse();

    const result = this.fromOpenAiResponse(data);
    const rateLimit = parseRateLimitHeaders(response.headers);
    return rateLimit ? { ...result, rateLimit } : result;
  }

  private toOpenAiTool(
    tool: LlmToolDefinition,
  ): OpenAI.Chat.ChatCompletionTool {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    };
  }

  private toOpenAiMessages(message: LlmMessage): ChatCompletionMessageParam[] {
    if (message.role === 'tool') {
      return (message.toolResults ?? []).map((result) => ({
        role: 'tool',
        tool_call_id: result.toolCallId,
        content: result.content,
      }));
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      return [
        {
          role: 'assistant',
          content: message.content ?? null,
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: 'function' as const,
            function: {
              name: call.name,
              arguments: JSON.stringify(call.arguments),
            },
          })),
        },
      ];
    }

    return [
      {
        role: message.role,
        content: message.content ?? '',
      },
    ];
  }

  private fromOpenAiResponse(
    response: OpenAI.Chat.Completions.ChatCompletion,
  ): LlmChatResult {
    const choice = response.choices[0];
    const toolCalls: LlmToolCall[] = (choice.message.tool_calls ?? [])
      .filter(
        (call): call is OpenAI.Chat.ChatCompletionMessageFunctionToolCall =>
          call.type === 'function',
      )
      .map((call) => ({
        id: call.id,
        name: call.function.name,
        arguments: JSON.parse(call.function.arguments) as Record<
          string,
          unknown
        >,
      }));

    return {
      content: choice.message.content ?? null,
      toolCalls,
      finishReason: this.mapFinishReason(choice.finish_reason),
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
      model: response.model,
    };
  }

  private mapFinishReason(
    finishReason: OpenAI.Chat.Completions.ChatCompletion.Choice['finish_reason'],
  ): LlmFinishReason {
    switch (finishReason) {
      case 'tool_calls':
        return 'tool_calls';
      case 'length':
        return 'length';
      case 'stop':
        return 'stop';
      default:
        return 'other';
    }
  }
}

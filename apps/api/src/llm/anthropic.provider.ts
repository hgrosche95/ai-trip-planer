import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  LlmChatOptions,
  LlmChatResult,
  LlmFinishReason,
  LlmMessage,
  LlmProvider,
  LlmToolCall,
  LlmToolDefinition,
} from './llm-provider.interface';

@Injectable()
export class AnthropicProvider implements LlmProvider {
  private readonly client = new Anthropic();

  async chat(
    messages: LlmMessage[],
    tools: LlmToolDefinition[],
    options: LlmChatOptions,
  ): Promise<LlmChatResult> {
    const system = messages.find((m) => m.role === 'system')?.content;
    const conversation = messages.filter((m) => m.role !== 'system');

    const response = await this.client.messages.create({
      model: options.model,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      system,
      tools: tools.map((tool) => this.toAnthropicTool(tool)),
      messages: conversation.map((m) => this.toAnthropicMessage(m)),
    });

    return this.fromAnthropicResponse(response);
  }

  private toAnthropicTool(tool: LlmToolDefinition): Anthropic.Tool {
    return {
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters as Anthropic.Tool.InputSchema,
    };
  }

  private toAnthropicMessage(message: LlmMessage): Anthropic.MessageParam {
    if (message.role === 'tool') {
      return {
        role: 'user',
        content: (message.toolResults ?? []).map((result) => ({
          type: 'tool_result',
          tool_use_id: result.toolCallId,
          content: result.content,
        })),
      };
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (message.content) {
        blocks.push({ type: 'text', text: message.content });
      }
      for (const call of message.toolCalls) {
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: call.arguments,
        });
      }
      return { role: 'assistant', content: blocks };
    }

    return {
      role: message.role as 'user' | 'assistant',
      content: message.content ?? '',
    };
  }

  private fromAnthropicResponse(response: Anthropic.Message): LlmChatResult {
    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    );
    const toolCalls: LlmToolCall[] = response.content
      .filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      )
      .map((block) => ({
        id: block.id,
        name: block.name,
        arguments: block.input as Record<string, unknown>,
      }));

    return {
      content: textBlock?.text ?? null,
      toolCalls,
      finishReason: this.mapFinishReason(response.stop_reason),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  private mapFinishReason(
    stopReason: Anthropic.Message['stop_reason'],
  ): LlmFinishReason {
    switch (stopReason) {
      case 'tool_use':
        return 'tool_calls';
      case 'max_tokens':
        return 'length';
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      default:
        return 'other';
    }
  }
}

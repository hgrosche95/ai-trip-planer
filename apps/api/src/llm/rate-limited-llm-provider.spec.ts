import type { LlmChatResult, LlmProvider } from './llm-provider.interface';
import { RateLimitedLlmProvider } from './rate-limited-llm-provider';
import { TokenBudgetLimiter } from './token-budget-limiter';

function result(rateLimit?: LlmChatResult['rateLimit']): LlmChatResult {
  return {
    content: 'ok',
    toolCalls: [],
    finishReason: 'stop',
    usage: { inputTokens: 1, outputTokens: 1 },
    model: 'groq-model',
    rateLimit,
  };
}

describe('RateLimitedLlmProvider', () => {
  const messages = [{ role: 'user' as const, content: 'Hallo' }];

  it('wartet vor dem zweiten Aufruf, wenn die erste Antwort das Budget aufgebraucht hat', async () => {
    const order: string[] = [];
    let now = 0;
    const limiter = new TokenBudgetLimiter({
      now: () => now,
      sleep: (ms) => {
        order.push(`sleep ${ms}`);
        now += ms;
        return Promise.resolve();
      },
    });
    const inner: LlmProvider = {
      chat: jest.fn(() => {
        order.push('chat');
        return Promise.resolve(
          result({ remainingTokens: 10, resetTokensMs: 6000 }),
        );
      }),
    };
    const provider = new RateLimitedLlmProvider(
      inner,
      limiter,
      (model) => model ?? 'default-model',
    );

    await provider.chat(messages, [], { maxTokens: 400 });
    await provider.chat(messages, [], { maxTokens: 400 });

    expect(order).toEqual(['chat', 'sleep 6000', 'chat']);
  });

  it('führt das Budget unter dem aufgelösten Modellnamen', async () => {
    const limiter = new TokenBudgetLimiter({ now: () => 0 });
    const update = jest.spyOn(limiter, 'update');
    const acquire = jest.spyOn(limiter, 'acquire');
    const inner: LlmProvider = {
      chat: jest.fn().mockResolvedValue(result({ remainingTokens: 5000 })),
    };
    const provider = new RateLimitedLlmProvider(
      inner,
      limiter,
      (model) => model ?? 'default-model',
    );

    await provider.chat(messages, [], { maxTokens: 400 });
    await provider.chat(messages, [], { maxTokens: 400, model: 'klein' });

    expect(acquire.mock.calls.map((call) => call[0])).toEqual([
      'default-model',
      'klein',
    ]);
    expect(update.mock.calls.map((call) => call[0])).toEqual([
      'default-model',
      'klein',
    ]);
  });

  it('meldet einen Fehler des Anbieters unverändert weiter', async () => {
    const error = { status: 429 };
    const inner: LlmProvider = { chat: jest.fn().mockRejectedValue(error) };
    const provider = new RateLimitedLlmProvider(
      inner,
      new TokenBudgetLimiter(),
      () => 'm',
    );

    await expect(provider.chat(messages, [], { maxTokens: 10 })).rejects.toBe(
      error,
    );
  });
});

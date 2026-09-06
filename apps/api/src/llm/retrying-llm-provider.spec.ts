import {
  RetryingLlmProvider,
  computeBackoffDelayMs,
} from './retrying-llm-provider';
import { LlmChatResult, LlmProvider } from './llm-provider.interface';

function makeRateLimitError(retryAfter: string | null = null) {
  return {
    status: 429,
    headers: {
      get: (name: string) => (name === 'retry-after' ? retryAfter : null),
    },
  };
}

describe('computeBackoffDelayMs', () => {
  it('uses the Retry-After header (in seconds) when present', () => {
    expect(computeBackoffDelayMs(0, '2')).toBe(2000);
  });

  it('ignores an invalid Retry-After header and falls back to backoff', () => {
    const delay = computeBackoffDelayMs(0, 'not-a-number');
    expect(delay).toBeGreaterThanOrEqual(1000);
  });

  it('grows exponentially with the attempt number', () => {
    const first = computeBackoffDelayMs(0);
    const second = computeBackoffDelayMs(1);
    const third = computeBackoffDelayMs(2);

    // jitter adds up to 1000ms on top of the exponential base, so compare
    // the guaranteed lower bounds instead of exact values.
    expect(second).toBeGreaterThanOrEqual(first);
    expect(third).toBeGreaterThanOrEqual(2000);
  });

  it('caps the delay at the configured maximum', () => {
    expect(computeBackoffDelayMs(10)).toBeLessThanOrEqual(30000);
  });
});

describe('RetryingLlmProvider', () => {
  const successResult: LlmChatResult = {
    content: 'ok',
    toolCalls: [],
    finishReason: 'stop',
    usage: { inputTokens: 1, outputTokens: 1 },
  };

  it('retries on a 429 and returns the eventual success', async () => {
    const chat = jest
      .fn()
      .mockRejectedValueOnce(makeRateLimitError('0'))
      .mockResolvedValueOnce(successResult);
    const inner: LlmProvider = { chat };
    const sleep = jest.fn().mockResolvedValue(undefined);
    const provider = new RetryingLlmProvider(inner, 3, sleep);

    const outcome = await provider.chat([], [], { maxTokens: 10 });

    expect(outcome).toBe(successResult);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('gives up and rethrows after exhausting the configured retries', async () => {
    const error = makeRateLimitError('0');
    const chat = jest.fn().mockRejectedValue(error);
    const inner: LlmProvider = { chat };
    const sleep = jest.fn().mockResolvedValue(undefined);
    const provider = new RetryingLlmProvider(inner, 2, sleep);

    await expect(provider.chat([], [], { maxTokens: 10 })).rejects.toBe(error);
    expect(chat).toHaveBeenCalledTimes(3); // initial attempt + 2 retries
  });

  it('does not retry errors that are not rate limits', async () => {
    const error = new Error('boom');
    const chat = jest.fn().mockRejectedValue(error);
    const inner: LlmProvider = { chat };
    const sleep = jest.fn();
    const provider = new RetryingLlmProvider(inner, 3, sleep);

    await expect(provider.chat([], [], { maxTokens: 10 })).rejects.toBe(error);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

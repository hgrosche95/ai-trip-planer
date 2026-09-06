import { Logger } from '@nestjs/common';
import {
  LlmChatOptions,
  LlmChatResult,
  LlmMessage,
  LlmProvider,
  LlmToolDefinition,
} from './llm-provider.interface';

const DEFAULT_MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

interface RateLimitError {
  status?: number;
  headers?: { get(name: string): string | null } | null;
}

export function computeBackoffDelayMs(
  attempt: number,
  retryAfterHeader?: string | null,
): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (!Number.isNaN(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
  }
  const exponential = BASE_DELAY_MS * 2 ** attempt;
  const jitter = Math.random() * BASE_DELAY_MS;
  return Math.min(exponential + jitter, MAX_DELAY_MS);
}

function isRateLimitError(error: unknown): error is RateLimitError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as RateLimitError).status === 429
  );
}

export class RetryingLlmProvider implements LlmProvider {
  private readonly logger = new Logger(RetryingLlmProvider.name);

  constructor(
    private readonly inner: LlmProvider,
    private readonly maxRetries: number = DEFAULT_MAX_RETRIES,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async chat(
    messages: LlmMessage[],
    tools: LlmToolDefinition[],
    options: LlmChatOptions,
  ): Promise<LlmChatResult> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.inner.chat(messages, tools, options);
      } catch (error) {
        if (!isRateLimitError(error) || attempt >= this.maxRetries) {
          throw error;
        }
        const retryAfter = error.headers?.get('retry-after') ?? null;
        const delay = computeBackoffDelayMs(attempt, retryAfter);
        this.logger.warn(
          `Rate-Limit (429) erhalten, Versuch ${attempt + 1}/${this.maxRetries}, warte ${delay}ms`,
        );
        await this.sleep(delay);
        attempt++;
      }
    }
  }
}

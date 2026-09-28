import { Logger } from '@nestjs/common';
import {
  LlmChatOptions,
  LlmChatResult,
  LlmMessage,
  LlmProvider,
  LlmToolDefinition,
} from './llm-provider.interface';
import { TokenBudgetLimiter, estimateCallTokens } from './token-budget-limiter';

// Dekorator wie RetryingLlmProvider: fragt vor jedem Aufruf den
// TokenBudgetLimiter, ob das Minutenbudget des Modells reicht (und wartet
// gegebenenfalls), und meldet ihm danach den neuen Stand aus der Antwort.
export class RateLimitedLlmProvider implements LlmProvider {
  private readonly logger = new Logger(RateLimitedLlmProvider.name);

  constructor(
    private readonly inner: LlmProvider,
    private readonly limiter: TokenBudgetLimiter,
    // Das Modell muss VOR dem Aufruf feststehen, weil Groq pro Modell zählt
    private readonly resolveModel: (model?: string) => string,
  ) {}

  async chat(
    messages: LlmMessage[],
    tools: LlmToolDefinition[],
    options: LlmChatOptions,
  ): Promise<LlmChatResult> {
    const model = this.resolveModel(options.model);
    const estimated = estimateCallTokens(messages, tools, options.maxTokens);
    await this.limiter.acquire(model, estimated, (waitMs, reason) => {
      this.logger.log(
        `Budget für ${model} reicht nicht (${reason}, ~${estimated} Tokens geschätzt), warte ${waitMs}ms`,
      );
    });
    const result = await this.inner.chat(messages, tools, options);
    this.limiter.update(model, result.rateLimit);
    return result;
  }
}

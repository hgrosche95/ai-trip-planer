import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { LLM_PROVIDER } from './llm/llm-provider.interface';
import { AnthropicProvider } from './llm/anthropic.provider';
import { GroqProvider } from './llm/groq.provider';
import { RetryingLlmProvider } from './llm/retrying-llm-provider';

@Module({
  controllers: [AgentController],
  providers: [
    AgentService,
    AnthropicProvider,
    GroqProvider,
    {
      provide: LLM_PROVIDER,
      useFactory: (anthropic: AnthropicProvider, groq: GroqProvider) => {
        const selected =
          process.env.LLM_PROVIDER === 'anthropic' ? anthropic : groq;
        return new RetryingLlmProvider(selected);
      },
      inject: [AnthropicProvider, GroqProvider],
    },
  ],
})
export class AgentModule {}

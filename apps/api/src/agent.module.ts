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
    {
      provide: LLM_PROVIDER,
      // Bewusst mit `new` statt über Nest-DI erzeugt: würden AnthropicProvider
      // und GroqProvider selbst als Provider registriert (damit die Factory
      // sie injizieren kann), würde Nest BEIDE beim Bootstrap instanziieren -
      // und beide SDK-Clients würden sofort einen gültigen API-Key verlangen,
      // selbst wenn nur einer der beiden Anbieter tatsächlich genutzt wird.
      useFactory: () => {
        const selected =
          process.env.LLM_PROVIDER === 'anthropic'
            ? new AnthropicProvider()
            : new GroqProvider();
        return new RetryingLlmProvider(selected);
      },
    },
  ],
})
export class AgentModule {}

import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { ItinerariesModule } from './itineraries.module';
import { ItinerariesService } from './itineraries.service';
import { Orchestrator, createOrchestrator } from './orchestrator/orchestrator';
import { LLM_PROVIDER } from './llm/llm-provider.interface';
import { AnthropicProvider } from './llm/anthropic.provider';
import { FakeLlmProvider } from './llm/fake.provider';
import { GroqProvider, resolveGroqModel } from './llm/groq.provider';
import { RateLimitedLlmProvider } from './llm/rate-limited-llm-provider';
import { RetryingLlmProvider } from './llm/retrying-llm-provider';
import { TokenBudgetLimiter } from './llm/token-budget-limiter';
import { EXTERNAL_CACHE, PrismaExternalCache } from './external/external-cache';
import { AGENT_RUN_STORE, PrismaAgentRunStore } from './runs/agent-run-store';
import {
  PrismaTripDraftStore,
  TRIP_DRAFT_STORE,
} from './orchestrator/trip-draft-store';
import {
  CONVERSATION_STORE,
  PrismaConversationStore,
} from './llm/conversation-store';

@Module({
  imports: [ItinerariesModule],
  controllers: [AgentController],
  providers: [
    AgentService,
    { provide: CONVERSATION_STORE, useClass: PrismaConversationStore },
    { provide: EXTERNAL_CACHE, useClass: PrismaExternalCache },
    { provide: AGENT_RUN_STORE, useClass: PrismaAgentRunStore },
    { provide: TRIP_DRAFT_STORE, useClass: PrismaTripDraftStore },
    // Multi-Agenten-Modus (AGENT_MODE=multi): dieselben Abhängigkeiten wie
    // AgentService, die Agenten bekommen je eine eigene ToolRegistry
    {
      provide: Orchestrator,
      useFactory: createOrchestrator,
      inject: [
        ItinerariesService,
        LLM_PROVIDER,
        CONVERSATION_STORE,
        EXTERNAL_CACHE,
        TRIP_DRAFT_STORE,
      ],
    },
    {
      provide: LLM_PROVIDER,
      // Bewusst mit `new` statt über Nest-DI erzeugt: würden AnthropicProvider
      // und GroqProvider selbst als Provider registriert (damit die Factory
      // sie injizieren kann), würde Nest BEIDE beim Bootstrap instanziieren -
      // und beide SDK-Clients würden sofort einen gültigen API-Key verlangen,
      // selbst wenn nur einer der beiden Anbieter tatsächlich genutzt wird.
      useFactory: () => {
        // Fake braucht weder Key noch Retry: feste Antworten ohne Tokens
        if (process.env.LLM_PROVIDER === 'fake') return new FakeLlmProvider();
        if (process.env.LLM_PROVIDER === 'anthropic') {
          return new RetryingLlmProvider(new AnthropicProvider());
        }
        // Groq: Der Limiter sitzt INNEN, direkt am Provider, der Retry
        // außen. So geht jede echte Anfrage an Groq, auch eine Wiederholung
        // nach 429, durch die Budgetprüfung, und der Limiter lernt aus jeder
        // Antwort unmittelbar. Das 429-Handling bleibt das Netz darunter,
        // falls die Schätzung daneben liegt oder andere Instanzen dasselbe
        // Budget verbraucht haben. LLM_RATE_LIMITER=off schaltet ihn ab.
        const groq = new GroqProvider();
        if (process.env.LLM_RATE_LIMITER === 'off') {
          return new RetryingLlmProvider(groq);
        }
        return new RetryingLlmProvider(
          new RateLimitedLlmProvider(
            groq,
            new TokenBudgetLimiter(),
            resolveGroqModel,
          ),
        );
      },
    },
  ],
})
export class AgentModule {}

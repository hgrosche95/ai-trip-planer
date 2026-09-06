import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { LLM_PROVIDER } from './llm/llm-provider.interface';
import { AnthropicProvider } from './llm/anthropic.provider';

@Module({
  controllers: [AgentController],
  providers: [
    AgentService,
    { provide: LLM_PROVIDER, useClass: AnthropicProvider },
  ],
})
export class AgentModule {}

import { Body, Controller, Post } from '@nestjs/common';
import { AgentService } from './agent.service';

interface ChatRequest {
  sessionId: string;
  message: string;
}

@Controller('agent')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post('chat')
  async chat(@Body() body: ChatRequest) {
    const reply = await this.agentService.sendMessage(
      body.sessionId,
      body.message,
    );
    return { reply };
  }
}

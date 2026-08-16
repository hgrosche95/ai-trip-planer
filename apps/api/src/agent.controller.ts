import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AgentService } from './agent.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';

interface ChatRequest {
  sessionId: string;
  message: string;
}

@Controller('agent')
@UseGuards(JwtAuthGuard)
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

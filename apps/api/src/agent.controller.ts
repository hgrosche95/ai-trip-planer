import { Body, Controller, Post } from '@nestjs/common';
import { AgentService } from './agent.service';

interface ChatRequest {
  sessionId: string;
  message: string;
}

// Kein Login-Zwang mehr (siehe itineraries.controller.ts): der Chat läuft
// ohnehin nur gegen das kostenlose Groq-Kontingent und alle Reisepläne
// landen auf demselben Demo-Nutzer, ein Login schützt hier also keine
// echten Nutzerdaten.
@Controller('agent')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post('chat')
  async chat(@Body() body: ChatRequest) {
    return this.agentService.sendMessage(body.sessionId, body.message);
  }
}

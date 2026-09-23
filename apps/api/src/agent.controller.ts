import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AgentService } from './agent.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from './auth/current-user';

interface ChatRequest {
  sessionId: string;
  message: string;
}

// Jede Nachricht kostet LLM-Tokens (bei LLM_PROVIDER=anthropic echtes Geld),
// deshalb Token-Pflicht (Gäste bekommen es automatisch), Rate-Limit und
// Längengrenzen.
export const MAX_MESSAGE_LENGTH = 2000;
const MAX_SESSION_ID_LENGTH = 100;

@Controller('agent')
@UseGuards(JwtAuthGuard)
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post('chat')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async chat(@CurrentUser() user: AuthUser, @Body() body: ChatRequest) {
    const { sessionId, message } = body ?? {};
    if (
      typeof sessionId !== 'string' ||
      sessionId.length === 0 ||
      sessionId.length > MAX_SESSION_ID_LENGTH
    ) {
      throw new BadRequestException('sessionId fehlt oder ist zu lang');
    }
    if (
      typeof message !== 'string' ||
      message.trim().length === 0 ||
      message.length > MAX_MESSAGE_LENGTH
    ) {
      throw new BadRequestException(
        `message muss 1 bis ${MAX_MESSAGE_LENGTH} Zeichen lang sein`,
      );
    }
    return this.agentService.sendMessage(user.userId, sessionId, message);
  }
}

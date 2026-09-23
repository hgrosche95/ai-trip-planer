import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';

interface LoginRequest {
  username: string;
  password: string;
}

const MINUTE = 60_000;

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 15 * MINUTE } })
  login(@Body() body: LoginRequest) {
    return this.authService.login(body.username, body.password);
  }

  // Jeder Aufruf legt eine User-Zeile an -> eng begrenzen. Ein Browser ruft
  // das nur beim allerersten Besuch (oder nach Ablauf des Tokens) auf.
  @Post('guest')
  @Throttle({ default: { limit: 10, ttl: 60 * MINUTE } })
  guest() {
    return this.authService.createGuest();
  }
}

import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

interface LoginRequest {
  username: string;
  password: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() body: LoginRequest) {
    return this.authService.login(body.username, body.password);
  }
}

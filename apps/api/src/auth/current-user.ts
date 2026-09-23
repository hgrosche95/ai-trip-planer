import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// owner = per /auth/login (Env-Zugangsdaten, u.a. vom MCP-Server genutzt),
// guest = anonymer Besucher, bekommt beim ersten Besuch eine eigene User-Zeile.
export type AuthRole = 'owner' | 'guest';

export interface AuthUser {
  userId: string;
  role: AuthRole;
}

export interface AuthTokenPayload {
  sub: string;
  role: AuthRole;
}

// Liefert den von JwtStrategy.validate() gesetzten Nutzer. Nur hinter
// JwtAuthGuard verwenden, sonst ist request.user undefined.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<{ user: AuthUser }>().user,
);

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthTokenPayload, AuthUser } from './current-user';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET ist nicht gesetzt');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  validate(payload: Partial<AuthTokenPayload>): AuthUser {
    // Tokens aus der Zeit vor der Mandantentrennung haben nur sub=<username>
    // und keine Rolle. Die werden abgelehnt: Web-Client und MCP-Server holen
    // sich bei 401 automatisch ein neues Token.
    if (
      typeof payload.sub !== 'string' ||
      (payload.role !== 'owner' && payload.role !== 'guest')
    ) {
      throw new UnauthorizedException('Token-Format veraltet');
    }
    return { userId: payload.sub, role: payload.role };
  }
}

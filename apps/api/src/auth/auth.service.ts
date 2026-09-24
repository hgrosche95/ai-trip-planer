import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma.service';
import type { AuthTokenPayload } from './current-user';

// Die Pläne aus der Zeit ohne Mandantentrennung gehören diesem Nutzer (die
// Migration benennt den alten guest@local.dev-Datensatz entsprechend um).
export const OWNER_EMAIL = 'owner@local.dev';

// Gäste haben kein Passwort und können sich nicht neu einloggen - ihr Token
// ist der einzige Schlüssel zu ihren Plänen, deshalb länger gültig als 7 Tage.
const GUEST_TOKEN_TTL = '30d';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async login(username: unknown, password: unknown) {
    // Der Body ist nicht validiert: ohne diese Prüfung wirft bcrypt.compare
    // bei fehlendem Passwort, und aus einem falschen Login wird eine 500.
    if (typeof username !== 'string' || typeof password !== 'string') {
      throw new UnauthorizedException('Ungültige Zugangsdaten');
    }

    const validUsername = process.env.AUTH_USERNAME;
    const passwordHash = process.env.AUTH_PASSWORD_HASH;

    const passwordMatches =
      !!passwordHash && (await bcrypt.compare(password, passwordHash));

    if (username !== validUsername || !passwordMatches) {
      throw new UnauthorizedException('Ungültige Zugangsdaten');
    }

    const owner = await this.prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL },
    });
    const payload: AuthTokenPayload = { sub: owner.id, role: 'owner' };
    return { accessToken: await this.jwtService.signAsync(payload) };
  }

  async createGuest() {
    const guest = await this.prisma.user.create({
      data: { email: `guest-${randomUUID()}@guest.local` },
    });
    const payload: AuthTokenPayload = { sub: guest.id, role: 'guest' };
    return {
      accessToken: await this.jwtService.signAsync(payload, {
        expiresIn: GUEST_TOKEN_TTL,
      }),
    };
  }
}

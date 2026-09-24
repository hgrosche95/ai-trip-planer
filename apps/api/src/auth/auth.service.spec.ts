import { UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService, OWNER_EMAIL } from './auth.service';
import type { PrismaService } from '../prisma.service';

describe('AuthService.login', () => {
  let service: AuthService;
  let prisma: { user: { upsert: jest.Mock } };

  beforeAll(async () => {
    process.env.AUTH_USERNAME = 'besitzer';
    process.env.AUTH_PASSWORD_HASH = await bcrypt.hash('richtig', 4);
  });

  beforeEach(() => {
    const jwt = { signAsync: jest.fn().mockResolvedValue('token') };
    prisma = {
      user: { upsert: jest.fn().mockResolvedValue({ id: 'owner-1' }) },
    };
    service = new AuthService(
      jwt as unknown as JwtService,
      prisma as unknown as PrismaService,
    );
  });

  it('gibt bei richtigen Zugangsdaten ein Besitzer-Token zurück', async () => {
    await expect(service.login('besitzer', 'richtig')).resolves.toEqual({
      accessToken: 'token',
    });
    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: OWNER_EMAIL } }),
    );
  });

  it('lehnt ein falsches Passwort mit 401 ab', async () => {
    await expect(service.login('besitzer', 'falsch')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // Vorher warf bcrypt.compare bei fehlendem Passwort, und daraus wurde eine 500.
  it.each([
    [undefined, undefined],
    ['besitzer', undefined],
    [undefined, 'richtig'],
    [123, ['richtig']],
  ])('lehnt fehlende oder falsche Felder mit 401 ab (%p, %p)', async (u, p) => {
    await expect(service.login(u, p)).rejects.toThrow(UnauthorizedException);
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });
});

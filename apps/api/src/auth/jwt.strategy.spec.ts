import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy.validate', () => {
  let strategy: JwtStrategy;

  beforeAll(() => {
    process.env.JWT_SECRET ??= 'test-secret';
    strategy = new JwtStrategy();
  });

  it('akzeptiert Gast- und Besitzer-Tokens', () => {
    expect(strategy.validate({ sub: 'u1', role: 'guest' })).toEqual({
      userId: 'u1',
      role: 'guest',
    });
    expect(strategy.validate({ sub: 'u2', role: 'owner' })).toEqual({
      userId: 'u2',
      role: 'owner',
    });
  });

  it('lehnt alte Tokens ohne Rolle ab (sub war früher der Username)', () => {
    expect(() => strategy.validate({ sub: 'admin' })).toThrow(
      UnauthorizedException,
    );
  });
});

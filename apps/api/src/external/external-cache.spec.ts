import type { PrismaService } from '../prisma.service';
import { PrismaExternalCache } from './external-cache';

describe('PrismaExternalCache', () => {
  let externalApiCache: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
    deleteMany: jest.Mock;
  };
  let cache: PrismaExternalCache;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-01T12:00:00Z'));
    externalApiCache = {
      findUnique: jest.fn(),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    cache = new PrismaExternalCache({
      externalApiCache,
    } as unknown as PrismaService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('liefert einen gültigen Eintrag', async () => {
    externalApiCache.findUnique.mockResolvedValue({
      payload: { a: 1 },
      expiresAt: new Date('2026-10-01T13:00:00Z'),
    });

    await expect(cache.get('k')).resolves.toEqual({ a: 1 });
  });

  it('liefert einen abgelaufenen Eintrag nicht mehr aus', async () => {
    externalApiCache.findUnique.mockResolvedValue({
      payload: { a: 1 },
      expiresAt: new Date('2026-10-01T11:59:00Z'),
    });

    await expect(cache.get('k')).resolves.toBeUndefined();
  });

  it('behandelt einen Datenbankfehler als Cache-Miss', async () => {
    externalApiCache.findUnique.mockRejectedValue(new Error('DB weg'));

    await expect(cache.get('k')).resolves.toBeUndefined();
  });

  it('speichert mit Ablaufzeit und wirft bei Datenbankfehlern nicht', async () => {
    await cache.set('k', 'open-meteo', { a: 1 }, 60 * 60 * 1000);

    expect(externalApiCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          key: 'k',
          provider: 'open-meteo',
          expiresAt: new Date('2026-10-01T13:00:00Z'),
        }) as unknown,
      }),
    );

    externalApiCache.upsert.mockRejectedValue(new Error('DB weg'));
    await expect(cache.set('k', 'x', {}, 1000)).resolves.toBeUndefined();
  });

  it('löscht abgelaufene Einträge höchstens einmal pro Stunde', async () => {
    await cache.set('a', 'p', {}, 1000);
    jest.advanceTimersByTime(30 * 60 * 1000);
    await cache.set('b', 'p', {}, 1000);

    expect(externalApiCache.deleteMany).toHaveBeenCalledTimes(1);
    expect(externalApiCache.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: new Date('2026-10-01T12:00:00Z') } },
    });

    jest.advanceTimersByTime(31 * 60 * 1000);
    await cache.set('c', 'p', {}, 1000);
    expect(externalApiCache.deleteMany).toHaveBeenCalledTimes(2);
  });
});

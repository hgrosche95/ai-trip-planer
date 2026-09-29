import { Prisma } from '../../generated/prisma/client';
import type { PrismaService } from '../prisma.service';
import { LISBON_BRIEF } from './testing.fixtures';
import { emptyFindings } from './trip-draft';
import {
  InMemoryTripDraftStore,
  PrismaTripDraftStore,
} from './trip-draft-store';
import type { StoredTripDraft } from './trip-draft-store';

jest.mock('../rag-client', () => ({ searchTravelKnowledge: jest.fn() }));

const STORED: StoredTripDraft = {
  revision: 1,
  brief: LISBON_BRIEF,
  draft: {
    destination: 'Lissabon',
    startDate: '2026-10-14',
    endDate: '2026-10-16',
    budgetCents: 80_000,
    currency: 'EUR',
    preferences: [],
    stops: [
      { dayNumber: 1, order: 1, title: 'Alfama', lat: 38.71, lng: -9.13 },
    ],
  },
  findings: {
    ...emptyFindings(),
    destination: { name: 'Lissabon', lat: 38.72, lng: -9.14 },
  },
  budget: {
    currency: 'EUR',
    limitCents: 80_000,
    totalCents: 60_000,
    status: 'ok',
    items: [{ category: 'food', cents: 10_500 }],
  },
};

describe('InMemoryTripDraftStore', () => {
  it('liefert den Entwurf pro Nutzer und Session, sonst null', async () => {
    const store = new InMemoryTripDraftStore();
    await store.save('user-a', 's1', STORED);

    await expect(store.load('user-a', 's1')).resolves.toEqual(STORED);
    await expect(store.load('user-b', 's1')).resolves.toBeNull();
    await expect(store.load('user-a', 's2')).resolves.toBeNull();
  });

  it('ersetzt den Entwurf beim nächsten Speichern', async () => {
    const store = new InMemoryTripDraftStore();
    await store.save('user-a', 's1', STORED);
    await store.save('user-a', 's1', { ...STORED, revision: 2 });

    expect((await store.load('user-a', 's1'))?.revision).toBe(2);
  });

  it('gibt Kopien heraus: Änderungen am Ergebnis landen nicht im Speicher', async () => {
    const store = new InMemoryTripDraftStore();
    await store.save('user-a', 's1', STORED);
    const loaded = await store.load('user-a', 's1');
    loaded!.draft.stops[0].title = 'geändert';

    expect((await store.load('user-a', 's1'))?.draft.stops[0].title).toBe(
      'Alfama',
    );
  });
});

describe('PrismaTripDraftStore', () => {
  let tripDraft: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
    deleteMany: jest.Mock;
  };
  let store: PrismaTripDraftStore;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-31T12:00:00Z'));
    tripDraft = {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    store = new PrismaTripDraftStore({ tripDraft } as unknown as PrismaService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('speichert per upsert auf (userId, sessionId)', async () => {
    await store.save('user-a', 's1', STORED);

    const [args] = tripDraft.upsert.mock.calls[0] as [
      {
        where: unknown;
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      },
    ];
    expect(args.where).toEqual({
      userId_sessionId: { userId: 'user-a', sessionId: 's1' },
    });
    expect(args.create).toMatchObject({
      userId: 'user-a',
      sessionId: 's1',
      revision: 1,
      brief: STORED.brief,
      draft: STORED.draft,
      findings: STORED.findings,
      budget: STORED.budget,
    });
  });

  it('entfernt beim Überschreiben ohne Budget das alte Budget', async () => {
    await store.save('user-a', 's1', { ...STORED, budget: undefined });

    const [args] = tripDraft.upsert.mock.calls[0] as [
      { update: { budget: unknown } },
    ];
    expect(args.update.budget).toBe(Prisma.DbNull);
  });

  it('liest den Entwurf zurück, ohne Budget ohne das Feld', async () => {
    tripDraft.findUnique.mockResolvedValue({
      revision: 3,
      brief: STORED.brief,
      draft: STORED.draft,
      findings: STORED.findings,
      budget: null,
    });

    const loaded = await store.load('user-a', 's1');

    expect(tripDraft.findUnique).toHaveBeenCalledWith({
      where: { userId_sessionId: { userId: 'user-a', sessionId: 's1' } },
    });
    expect(loaded).toEqual({ ...STORED, revision: 3, budget: undefined });
    expect(loaded).not.toHaveProperty('budget');
  });

  it('löscht beim Speichern Entwürfe, die 30 Tage nicht geändert wurden, höchstens einmal pro Stunde', async () => {
    await store.save('user-a', 's1', STORED);
    jest.advanceTimersByTime(30 * 60 * 1000);
    await store.save('user-a', 's1', STORED);

    expect(tripDraft.deleteMany).toHaveBeenCalledTimes(1);
    expect(tripDraft.deleteMany).toHaveBeenCalledWith({
      where: { updatedAt: { lt: new Date('2026-10-01T12:00:00Z') } },
    });

    jest.advanceTimersByTime(31 * 60 * 1000);
    await store.save('user-a', 's1', STORED);
    expect(tripDraft.deleteMany).toHaveBeenCalledTimes(2);
  });

  it('speichert auch, wenn das Aufräumen fehlschlägt', async () => {
    tripDraft.deleteMany.mockRejectedValue(new Error('DB weg'));

    await expect(store.save('user-a', 's1', STORED)).resolves.toBeUndefined();
    expect(tripDraft.upsert).toHaveBeenCalled();
  });
});

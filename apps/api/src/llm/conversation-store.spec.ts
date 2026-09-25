import type { PrismaService } from '../prisma.service';
import { PrismaConversationStore } from './conversation-store';

describe('PrismaConversationStore: Aufräumen alter Verläufe', () => {
  let conversation: { upsert: jest.Mock; deleteMany: jest.Mock };
  let store: PrismaConversationStore;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-31T12:00:00Z'));
    conversation = {
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    store = new PrismaConversationStore({
      conversation,
    } as unknown as PrismaService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('löscht beim Speichern Verläufe, die 30 Tage nicht benutzt wurden', async () => {
    await store.save('user-a', 'session-1', []);

    expect(conversation.deleteMany).toHaveBeenCalledWith({
      where: { updatedAt: { lt: new Date('2026-10-01T12:00:00Z') } },
    });
  });

  it('räumt höchstens einmal pro Stunde auf', async () => {
    await store.save('user-a', 'session-1', []);
    jest.advanceTimersByTime(30 * 60 * 1000);
    await store.save('user-a', 'session-1', []);

    expect(conversation.deleteMany).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(31 * 60 * 1000);
    await store.save('user-a', 'session-1', []);

    expect(conversation.deleteMany).toHaveBeenCalledTimes(2);
  });

  it('speichert den Chat auch, wenn das Aufräumen fehlschlägt', async () => {
    conversation.deleteMany.mockRejectedValue(new Error('DB weg'));

    await expect(
      store.save('user-a', 'session-1', []),
    ).resolves.toBeUndefined();
    expect(conversation.upsert).toHaveBeenCalled();
  });
});

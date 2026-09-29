import type { PrismaService } from '../prisma.service';
import {
  MAX_STORED_EVENTS,
  PrismaAgentRunStore,
  capEvents,
  toMicroUsd,
  type FinishedAgentRun,
} from './agent-run-store';
import type { RunEvent } from './run-events';

function toolEvents(count: number): RunEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    type: 'tool.started' as const,
    seq: index + 1,
    elapsedMs: index,
    data: { stepId: `t${index}`, tool: 'get_weather' },
  }));
}

function finishedRun(events: RunEvent[] = []): FinishedAgentRun {
  return {
    id: 'run-1',
    userId: 'user-a',
    sessionId: 's1',
    status: 'OK',
    totals: {
      llmCalls: 2,
      toolCalls: 1,
      inputTokens: 3900,
      outputTokens: 390,
      costUsd: 0.0012345,
      durationMs: 4200,
    },
    events,
    createdAt: new Date('2026-10-31T11:59:55Z'),
    finishedAt: new Date('2026-10-31T12:00:00Z'),
  };
}

describe('capEvents', () => {
  it('lässt kurze Läufe unverändert', () => {
    const events = toolEvents(3);
    expect(capEvents(events)).toBe(events);
  });

  it('kürzt auf 500 Ereignisse und behält Anfang und Ende', () => {
    const events = toolEvents(800);

    const capped = capEvents(events);

    expect(capped).toHaveLength(MAX_STORED_EVENTS);
    expect(capped[0].seq).toBe(1);
    // Das Ende mit Antwort und run.finished bleibt erhalten
    expect(capped.at(-1)?.seq).toBe(800);
    expect(capped.map((event) => event.seq)).toEqual(
      [...capped.map((event) => event.seq)].sort((a, b) => a - b),
    );
  });
});

describe('toMicroUsd', () => {
  it('rechnet US-Dollar in ganze Mikro-Dollar um', () => {
    expect(toMicroUsd(0.0012345)).toBe(1235);
    expect(toMicroUsd(0)).toBe(0);
  });
});

describe('PrismaAgentRunStore', () => {
  let agentRun: { create: jest.Mock; deleteMany: jest.Mock };
  let store: PrismaAgentRunStore;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-31T12:00:00Z'));
    agentRun = {
      create: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    store = new PrismaAgentRunStore({ agentRun } as unknown as PrismaService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('schreibt Summen als Spalten und höchstens 500 Ereignisse', async () => {
    await store.save(finishedRun(toolEvents(600)));

    const [[{ data }]] = agentRun.create.mock.calls as [
      [{ data: { events: unknown[] } }],
    ];
    expect(data).toMatchObject({
      id: 'run-1',
      userId: 'user-a',
      status: 'OK',
      llmCalls: 2,
      toolCalls: 1,
      inputTokens: 3900,
      outputTokens: 390,
      costMicroUsd: 1235,
      durationMs: 4200,
    });
    expect(data.events).toHaveLength(MAX_STORED_EVENTS);
  });

  it('löscht beim Speichern Läufe, die älter als 30 Tage sind', async () => {
    await store.save(finishedRun());

    expect(agentRun.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date('2026-10-01T12:00:00Z') } },
    });
  });

  it('räumt höchstens einmal pro Stunde auf', async () => {
    await store.save(finishedRun());
    jest.advanceTimersByTime(30 * 60 * 1000);
    await store.save(finishedRun());

    expect(agentRun.deleteMany).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(31 * 60 * 1000);
    await store.save(finishedRun());

    expect(agentRun.deleteMany).toHaveBeenCalledTimes(2);
  });

  it('speichert den Lauf auch, wenn das Aufräumen fehlschlägt', async () => {
    agentRun.deleteMany.mockRejectedValue(new Error('DB weg'));

    await expect(store.save(finishedRun())).resolves.toBeUndefined();
    expect(agentRun.create).toHaveBeenCalled();
  });
});

describe('PrismaAgentRunStore.findForUser', () => {
  it('sucht nach ID UND Nutzer und rechnet die Summen zurück', async () => {
    const row = {
      id: 'run-1',
      createdAt: new Date('2026-10-31T12:00:00Z'),
      status: 'OK',
      llmCalls: 2,
      toolCalls: 1,
      inputTokens: 3900,
      outputTokens: 390,
      costMicroUsd: 1235,
      durationMs: 4200,
      events: toolEvents(2),
    };
    const agentRun = { findFirst: jest.fn().mockResolvedValue(row) };
    const store = new PrismaAgentRunStore({
      agentRun,
    } as unknown as PrismaService);

    const run = await store.findForUser('user-a', 'run-1');

    expect(agentRun.findFirst).toHaveBeenCalledWith({
      where: { id: 'run-1', userId: 'user-a' },
    });
    expect(run).toMatchObject({
      status: 'ok',
      totals: { inputTokens: 3900, costUsd: 0.001235, durationMs: 4200 },
    });
    expect(run?.events).toHaveLength(2);
  });

  it('liefert null für fremde oder unbekannte Läufe', async () => {
    const agentRun = { findFirst: jest.fn().mockResolvedValue(null) };
    const store = new PrismaAgentRunStore({
      agentRun,
    } as unknown as PrismaService);

    await expect(store.findForUser('user-b', 'run-1')).resolves.toBeNull();
  });
});

describe('PrismaAgentRunStore.tokensSince', () => {
  it('summiert Ein- und Ausgabe-Tokens des Nutzers seit dem Zeitpunkt', async () => {
    const aggregate = jest.fn().mockResolvedValue({
      _sum: { inputTokens: 4000, outputTokens: 1500 },
    });
    const store = new PrismaAgentRunStore({
      agentRun: { aggregate },
    } as unknown as PrismaService);
    const since = new Date('2026-09-28T12:00:00Z');

    expect(await store.tokensSince('guest-1', since)).toBe(5500);
    expect(aggregate).toHaveBeenCalledWith({
      where: { userId: 'guest-1', createdAt: { gte: since } },
      _sum: { inputTokens: true, outputTokens: true },
    });
  });

  it('ohne Läufe 0 (Prisma liefert dann null)', async () => {
    const store = new PrismaAgentRunStore({
      agentRun: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: { inputTokens: null, outputTokens: null },
        }),
      },
    } as unknown as PrismaService);
    expect(await store.tokensSince('guest-1', new Date())).toBe(0);
  });
});

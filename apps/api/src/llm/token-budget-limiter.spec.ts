import {
  MAX_THROTTLE_MS,
  TokenBudgetLimiter,
  estimateCallTokens,
} from './token-budget-limiter';

// Uhr und sleep zum Anfassen: sleep spult die Uhr vor, statt zu warten
function fakeClock(start = 1_000_000) {
  let now = start;
  const sleeps: number[] = [];
  return {
    now: () => now,
    sleep: (ms: number) => {
      sleeps.push(ms);
      now += ms;
      return Promise.resolve();
    },
    advance: (ms: number) => {
      now += ms;
    },
    sleeps,
  };
}

describe('estimateCallTokens', () => {
  it('rechnet Zeichen / 4 plus ein Viertel von maxTokens', () => {
    const tokens = estimateCallTokens(
      [{ role: 'user', content: 'x'.repeat(400) }],
      [],
      1000,
    );
    expect(tokens).toBe(100 + 250);
  });

  it('zählt Tool-Aufrufe, Tool-Ergebnisse und Tool-Definitionen mit', () => {
    const bare = estimateCallTokens([], [], 0);
    const full = estimateCallTokens(
      [
        {
          role: 'assistant',
          toolCalls: [{ id: '1', name: 'get_weather', arguments: { a: 1 } }],
        },
        {
          role: 'tool',
          toolResults: [{ toolCallId: '1', content: 'y'.repeat(80) }],
        },
      ],
      [
        {
          name: 'get_weather',
          description: 'z'.repeat(40),
          parameters: { type: 'object' },
        },
      ],
      0,
    );
    expect(bare).toBe(0);
    // get_weather (11) + {"a":1} (7) + 80 + 11 + 40 + {"type":"object"} (17)
    expect(full).toBe(Math.ceil((11 + 7 + 80 + 11 + 40 + 17) / 4));
  });
});

describe('TokenBudgetLimiter', () => {
  it('lässt ohne Wissen über das Modell sofort durch', async () => {
    const clock = fakeClock();
    const limiter = new TokenBudgetLimiter(clock);

    await expect(limiter.acquire('m', 5000)).resolves.toEqual({
      waitedMs: 0,
    });
    expect(clock.sleeps).toEqual([]);
  });

  it('lässt durch, wenn das Restbudget reicht', async () => {
    const clock = fakeClock();
    const limiter = new TokenBudgetLimiter(clock);
    limiter.update('m', { remainingTokens: 3000, resetTokensMs: 6000 });

    await expect(limiter.acquire('m', 2000)).resolves.toEqual({
      waitedMs: 0,
    });
  });

  it('wartet bis zum Reset, wenn das Budget nicht reicht', async () => {
    const clock = fakeClock();
    const limiter = new TokenBudgetLimiter(clock);
    const onWait = jest.fn();
    limiter.update('m', { remainingTokens: 800, resetTokensMs: 6200 });
    clock.advance(200);

    await expect(limiter.acquire('m', 2000, onWait)).resolves.toEqual({
      waitedMs: 6000,
    });
    expect(clock.sleeps).toEqual([6000]);
    expect(onWait).toHaveBeenCalledWith(6000, 'tokens');
  });

  it('wartet nicht, wenn der Reset schon vorbei ist', async () => {
    const clock = fakeClock();
    const limiter = new TokenBudgetLimiter(clock);
    limiter.update('m', { remainingTokens: 0, resetTokensMs: 1000 });
    clock.advance(1500);

    await expect(limiter.acquire('m', 2000)).resolves.toEqual({
      waitedMs: 0,
    });
  });

  it('lässt durch statt zu warten, wenn der Reset zu weit weg ist', async () => {
    const clock = fakeClock();
    const limiter = new TokenBudgetLimiter(clock);
    const onWait = jest.fn();
    limiter.update('m', {
      remainingTokens: 0,
      resetTokensMs: MAX_THROTTLE_MS + 1,
    });

    await expect(limiter.acquire('m', 100, onWait)).resolves.toEqual({
      waitedMs: 0,
    });
    expect(onWait).not.toHaveBeenCalled();
  });

  it('wartet auf das Request-Limit, wenn keine Anfrage mehr frei ist', async () => {
    const clock = fakeClock();
    const limiter = new TokenBudgetLimiter(clock);
    const onWait = jest.fn();
    limiter.update('m', {
      remainingTokens: 7000,
      resetTokensMs: 1000,
      remainingRequests: 0,
      resetRequestsMs: 4000,
    });

    await limiter.acquire('m', 100, onWait);

    expect(onWait).toHaveBeenCalledWith(4000, 'requests');
  });

  it('führt die Modelle getrennt, weil Groq pro Modell zählt', async () => {
    const clock = fakeClock();
    const limiter = new TokenBudgetLimiter(clock);
    limiter.update('gross', { remainingTokens: 0, resetTokensMs: 5000 });

    await expect(limiter.acquire('klein', 2000)).resolves.toEqual({
      waitedMs: 0,
    });
    await expect(limiter.acquire('gross', 2000)).resolves.toEqual({
      waitedMs: 5000,
    });
  });

  it('zieht durchgelassene Aufrufe vom bekannten Budget ab', async () => {
    const clock = fakeClock();
    const limiter = new TokenBudgetLimiter(clock);
    limiter.update('m', { remainingTokens: 3000, resetTokensMs: 8000 });

    // Zwei parallele Läufe: der erste passt noch, der zweite nicht mehr
    await expect(limiter.acquire('m', 2000)).resolves.toEqual({
      waitedMs: 0,
    });
    await expect(limiter.acquire('m', 2000)).resolves.toEqual({
      waitedMs: 8000,
    });
  });

  it('vergisst den Stand nach dem Warten und bei Antworten ohne Header', async () => {
    const clock = fakeClock();
    const limiter = new TokenBudgetLimiter(clock);
    limiter.update('m', { remainingTokens: 0, resetTokensMs: 3000 });
    await limiter.acquire('m', 100);
    await expect(limiter.acquire('m', 100)).resolves.toEqual({ waitedMs: 0 });

    limiter.update('m', { remainingTokens: 0, resetTokensMs: 3000 });
    limiter.update('m', undefined);
    await expect(limiter.acquire('m', 100)).resolves.toEqual({ waitedMs: 0 });
  });
});

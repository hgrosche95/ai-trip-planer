import { parseDurationMs, parseRateLimitHeaders } from './rate-limit-headers';

function headers(values: Record<string, string>) {
  return { get: (name: string) => values[name] ?? null };
}

describe('parseDurationMs', () => {
  it.each([
    ['6.2s', 6200],
    ['1m2.5s', 62500],
    ['120ms', 120],
    ['2m59.56s', 179560],
    ['1h2m3s', 3723000],
    ['0s', 0],
    ['7.66s', 7660],
    [' 3s ', 3000],
    ['2', 2000],
    ['1.5', 1500],
  ])('liest "%s" als %i ms', (input, expected) => {
    expect(parseDurationMs(input)).toBe(expected);
  });

  it.each([
    [null],
    [undefined],
    [''],
    ['abc'],
    ['6.2x'],
    ['s'],
    ['1m foo'],
    ['-3s'],
    ['3s2'],
  ])('ergibt undefined für %p', (input) => {
    expect(parseDurationMs(input)).toBeUndefined();
  });
});

describe('parseRateLimitHeaders', () => {
  it('liest alle vier Header', () => {
    expect(
      parseRateLimitHeaders(
        headers({
          'x-ratelimit-remaining-tokens': '1500',
          'x-ratelimit-reset-tokens': '6.2s',
          'x-ratelimit-remaining-requests': '999',
          'x-ratelimit-reset-requests': '1m26.4s',
        }),
      ),
    ).toEqual({
      remainingTokens: 1500,
      resetTokensMs: 6200,
      remainingRequests: 999,
      resetRequestsMs: 86400,
    });
  });

  it('lässt fehlende oder kaputte Werte weg', () => {
    expect(
      parseRateLimitHeaders(
        headers({
          'x-ratelimit-remaining-tokens': '0',
          'x-ratelimit-reset-tokens': 'bald',
          'x-ratelimit-remaining-requests': 'viele',
        }),
      ),
    ).toEqual({ remainingTokens: 0 });
  });

  it('ergibt undefined ohne Rate-Limit-Header', () => {
    expect(parseRateLimitHeaders(headers({}))).toBeUndefined();
  });
});

import { InMemoryExternalCache } from './external-cache';
import { fetchJsonCached, USER_AGENT } from './http-client';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

describe('fetchJsonCached', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  let cache: InMemoryExternalCache;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    cache = new InMemoryExternalCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  const options = () => ({
    cache,
    cacheKey: 'test:key',
    provider: 'test-api',
    ttlMs: 60_000,
  });

  it('holt bei einem Cache-Miss die Daten und speichert sie', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ value: 42 }));

    const result = await fetchJsonCached('https://example.test/a', options());

    expect(result).toEqual({
      available: true,
      data: { value: 42 },
      cached: false,
    });
    expect(cache.entries.get('test:key')?.provider).toBe('test-api');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(
      USER_AGENT,
    );
  });

  it('liefert einen Cache-Treffer ohne Netzwerkaufruf', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ value: 42 }));
    await fetchJsonCached('https://example.test/a', options());

    const second = await fetchJsonCached('https://example.test/a', options());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual({
      available: true,
      data: { value: 42 },
      cached: true,
    });
  });

  it('fragt nach Ablauf der TTL erneut', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-01T12:00:00Z'));
    fetchMock.mockResolvedValue(jsonResponse({ value: 1 }));
    await fetchJsonCached('https://example.test/a', options());

    jest.setSystemTime(new Date('2026-10-01T12:01:01Z'));
    const result = await fetchJsonCached('https://example.test/a', options());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.cached).toBe(false);
  });

  it('meldet einen Status außerhalb 2xx als nicht verfügbar und cacht nichts', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ reason: 'kaputt' }, 503));

    const result = await fetchJsonCached('https://example.test/a', options());

    expect(result).toMatchObject({ available: false, cached: false });
    expect(!result.available && result.error).toContain('503');
    expect(cache.entries.size).toBe(0);
  });

  it('wirft bei einem Netzwerkfehler nicht', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await fetchJsonCached('https://example.test/a', options());

    expect(result.available).toBe(false);
    expect(!result.available && result.error).toContain('ECONNREFUSED');
  });

  it('meldet eine Zeitüberschreitung verständlich', async () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    fetchMock.mockRejectedValue(timeout);

    const result = await fetchJsonCached('https://example.test/a', {
      ...options(),
      timeoutMs: 10,
    });

    expect(!result.available && result.error).toContain('Zeitüberschreitung');
  });

  it('cacht keine Antwort, die die Prüfung nicht besteht', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ unerwartet: true }));
    const isValid = (data: unknown): data is { value: number } =>
      typeof data === 'object' && data !== null && 'value' in data;

    const result = await fetchJsonCached('https://example.test/a', {
      ...options(),
      isValid,
    });

    expect(result.available).toBe(false);
    expect(cache.entries.size).toBe(0);
  });

  it('schickt ohne Angabe ein GET ohne Body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ value: 42 }));

    await fetchJsonCached('https://example.test/a', options());

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(
      (init.headers as Record<string, string>)['Content-Type'],
    ).toBeUndefined();
  });

  it('schickt auf Wunsch ein POST mit Body und Content-Type', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ value: 42 }));

    await fetchJsonCached('https://example.test/a', {
      ...options(),
      method: 'POST',
      body: 'data=abc',
      contentType: 'application/x-www-form-urlencoded',
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('data=abc');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
  });
});

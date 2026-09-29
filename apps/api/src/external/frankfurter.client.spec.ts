import { InMemoryExternalCache } from './external-cache';
import { FrankfurterClient, isCurrencyCode } from './frankfurter.client';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

describe('FrankfurterClient', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  let cache: InMemoryExternalCache;
  let client: FrankfurterClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    cache = new InMemoryExternalCache();
    client = new FrankfurterClient(cache);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('holt den EZB-Kurs und merkt ihn sich 12 Stunden', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        amount: 1,
        base: 'PLN',
        date: '2026-09-25',
        rates: { EUR: 0.2345 },
      }),
    );

    const result = await client.rate('PLN', 'EUR');

    expect(result).toEqual({
      available: true,
      cached: false,
      data: { from: 'PLN', to: 'EUR', rate: 0.2345, date: '2026-09-25' },
    });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      'https://api.frankfurter.app/latest?from=PLN&to=EUR',
    );
    const entry = cache.entries.get('frankfurter:PLN:EUR');
    expect(entry?.provider).toBe('frankfurter');
    const ttl = entry!.expiresAt - Date.now();
    expect(ttl).toBeGreaterThan(11.9 * 60 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(12 * 60 * 60 * 1000);

    const second = await client.rate('PLN', 'EUR');
    expect(second.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lehnt ungültige Währungscodes ohne Netzaufruf ab', async () => {
    for (const [from, to] of [
      ['eur', 'USD'],
      ['EURO', 'USD'],
      ['EUR', 'U$D'],
      ['EUR&x=1', 'USD'],
    ]) {
      const result = await client.rate(from, to);
      expect(result.available).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('liefert für gleiche Währungen den Kurs 1 ohne Netzaufruf', async () => {
    const result = await client.rate('EUR', 'EUR');

    expect(result.data?.rate).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('meldet eine unbekannte Währung (404) als nicht verfügbar', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'not found' }, 404));

    const result = await client.rate('EUR', 'XYZ');

    expect(result.available).toBe(false);
    expect(cache.entries.size).toBe(0);
  });

  it('cacht keine Antwort ohne den gewünschten Kurs', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ amount: 1, base: 'EUR', date: '2026-09-25', rates: {} }),
    );

    const result = await client.rate('EUR', 'USD');

    expect(result.available).toBe(false);
    expect(cache.entries.size).toBe(0);
  });

  it('meldet einen Netzwerkfehler als nicht verfügbar', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await client.rate('EUR', 'USD');

    expect(!result.available && result.error).toContain('ECONNREFUSED');
  });

  it('erkennt Währungscodes', () => {
    expect(isCurrencyCode('CZK')).toBe(true);
    expect(isCurrencyCode('czk')).toBe(false);
    expect(isCurrencyCode(12)).toBe(false);
  });
});

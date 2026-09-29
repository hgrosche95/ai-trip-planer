import { InMemoryExternalCache } from './external-cache';
import { NagerDateClient } from './nager-date.client';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

const PT_2026 = [
  {
    date: '2026-10-05',
    localName: 'Implantação da República',
    name: 'Republic Day',
    global: true,
  },
  {
    date: '2026-06-13',
    localName: 'Santo António',
    name: "Saint Anthony's Day",
    global: false,
  },
];

describe('NagerDateClient', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  let cache: InMemoryExternalCache;
  let client: NagerDateClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    cache = new InMemoryExternalCache();
    client = new NagerDateClient(cache);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('holt die landesweiten Feiertage eines Jahres und merkt sie sich', async () => {
    fetchMock.mockResolvedValue(jsonResponse(PT_2026));

    const result = await client.holidays(2026, 'PT');

    expect(result).toEqual({
      available: true,
      cached: false,
      data: [
        {
          date: '2026-10-05',
          localName: 'Implantação da República',
          name: 'Republic Day',
        },
      ],
    });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      'https://date.nager.at/api/v3/PublicHolidays/2026/PT',
    );
    expect(cache.entries.get('nager-date:2026:PT')?.provider).toBe(
      'nager-date',
    );
    expect((await client.holidays(2026, 'PT')).cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lehnt ungültige Eingaben ohne Netzaufruf ab', async () => {
    for (const [year, code] of [
      [2026, 'pt'],
      [2026, 'PRT'],
      [2026, '../x'],
      [1800, 'PT'],
      [2026.5, 'PT'],
    ] as const) {
      expect((await client.holidays(year, code)).available).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('eine unerwartete Antwort landet nicht im Cache', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'unknown country' }));

    const result = await client.holidays(2026, 'XX');

    expect(result.available).toBe(false);
    expect(cache.entries.size).toBe(0);
  });
});

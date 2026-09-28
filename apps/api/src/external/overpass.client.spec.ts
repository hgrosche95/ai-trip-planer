import { InMemoryExternalCache } from './external-cache';
import { OverpassClient, lodgingQuery, MAX_LODGINGS } from './overpass.client';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

// Mittelpunkt wie nach dem Runden im Client (48.2082 → 48.21)
const CENTER = { lat: 48.21, lng: 16.37 };

describe('OverpassClient', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  let cache: InMemoryExternalCache;
  let client: OverpassClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    cache = new InMemoryExternalCache();
    client = new OverpassClient(cache);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fragt per POST im Umkreis und liefert Name, Koordinaten, Art, Sterne', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        elements: [
          {
            type: 'node',
            lat: 48.2039,
            lon: 16.3699,
            tags: {
              tourism: 'hotel',
              name: 'Hotel Sacher',
              stars: '5',
              website: 'https://www.sacher.com',
            },
          },
          {
            // Gebäudeumriss: Koordinaten über "center"
            type: 'way',
            center: { lat: 48.2101, lon: 16.3701 },
            tags: { tourism: 'hostel', name: 'Wombats', stars: 'keine' },
          },
        ],
      }),
    );

    const result = await client.lodgings(48.2082, 16.3738);

    expect(result).toEqual({
      available: true,
      cached: false,
      data: [
        {
          // näher am gerundeten Mittelpunkt, deshalb zuerst
          name: 'Wombats',
          lat: 48.2101,
          lng: 16.3701,
          kind: 'hostel',
        },
        {
          name: 'Hotel Sacher',
          lat: 48.2039,
          lng: 16.3699,
          kind: 'hotel',
          stars: 5,
          website: 'https://www.sacher.com',
        },
      ],
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://overpass-api.de/api/interpreter');
    expect(init.method).toBe('POST');
    const query = new URLSearchParams(init.body as string).get('data');
    expect(query).toContain('[out:json][timeout:10];');
    expect(query).toContain('(around:2500,48.21,16.37)');
    expect(query).toContain('^(hotel|hostel|guest_house|apartment)$');
    expect(query).toContain('["name"]');
  });

  it('lässt Einträge ohne Namen, ohne Koordinaten, anderer Art und Dubletten weg', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        elements: [
          { type: 'node', lat: 48.21, lon: 16.37, tags: { tourism: 'hotel' } },
          {
            type: 'node',
            lat: 48.21,
            lon: 16.37,
            tags: { tourism: 'museum', name: 'Albertina' },
          },
          { type: 'relation', tags: { tourism: 'hotel', name: 'Ohne Ort' } },
          {
            type: 'node',
            lat: 48.211,
            lon: 16.371,
            tags: { tourism: 'guest_house', name: 'Pension Nossek' },
          },
          {
            type: 'way',
            center: { lat: 48.2111, lon: 16.3711 },
            tags: { tourism: 'guest_house', name: 'pension nossek' },
          },
          {
            type: 'node',
            lat: 48.212,
            lon: 16.372,
            tags: { tourism: 'apartment', name: 'Apartment 3S', stars: '3S' },
          },
          {
            // Webseite ohne http(s) wird nicht übernommen
            type: 'node',
            lat: 48.213,
            lon: 16.373,
            tags: {
              tourism: 'hotel',
              name: 'Hotel Ohne Link',
              website: 'javascript:alert(1)',
            },
          },
        ],
      }),
    );

    const result = await client.lodgings(48.21, 16.37);

    expect(
      result.data?.map((l) => [l.name, l.kind, l.stars, l.website]),
    ).toEqual([
      ['Pension Nossek', 'guest_house', undefined, undefined],
      ['Apartment 3S', 'apartment', 3, undefined],
      ['Hotel Ohne Link', 'hotel', undefined, undefined],
    ]);
  });

  it(`liefert höchstens ${MAX_LODGINGS} Unterkünfte, die nächsten zuerst`, async () => {
    const elements = Array.from({ length: 30 }, (_, index) => ({
      type: 'node',
      lat: CENTER.lat + (30 - index) * 0.001,
      lon: CENTER.lng,
      tags: { tourism: 'hotel', name: `Hotel ${30 - index}` },
    }));
    fetchMock.mockResolvedValue(jsonResponse({ elements }));

    const result = await client.lodgings(CENTER.lat, CENTER.lng);

    expect(result.data).toHaveLength(MAX_LODGINGS);
    expect(result.data?.[0].name).toBe('Hotel 1');
    expect(result.data?.at(-1)?.name).toBe(`Hotel ${MAX_LODGINGS}`);
  });

  it('rundet den Cache-Schlüssel auf 2 Nachkommastellen und trifft ihn beim zweiten Aufruf', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ elements: [] }));

    await client.lodgings(48.2082, 16.3738);
    const second = await client.lodgings(48.2111, 16.3712);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ available: true, data: [], cached: true });
    expect([...cache.entries.keys()]).toEqual([
      'overpass:lodging:48.21,16.37:2500',
    ]);
    // 7 Tage
    const entry = cache.entries.get('overpass:lodging:48.21,16.37:2500');
    expect(entry!.expiresAt - Date.now()).toBeGreaterThan(
      6.9 * 24 * 60 * 60 * 1000,
    );
  });

  it('meldet einen Ausfall als available: false und cacht nichts', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ remark: 'busy' }, 429));

    const result = await client.lodgings(48.21, 16.37);

    expect(result.available).toBe(false);
    expect(!result.available && result.error).toContain('429');
    expect(cache.entries.size).toBe(0);
  });

  it('verwirft eine Antwort ohne elements', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ remark: 'runtime error' }));

    const result = await client.lodgings(48.21, 16.37);

    expect(result.available).toBe(false);
    expect(cache.entries.size).toBe(0);
  });

  it('baut die Abfrage mit Limit und Mittelpunkten für Gebäude', () => {
    expect(lodgingQuery('38.72', '-9.14', 3000)).toBe(
      [
        '[out:json][timeout:10];',
        'nwr["tourism"~"^(hotel|hostel|guest_house|apartment)$"]["name"](around:3000,38.72,-9.14);',
        'out center 60;',
      ].join('\n'),
    );
  });
});

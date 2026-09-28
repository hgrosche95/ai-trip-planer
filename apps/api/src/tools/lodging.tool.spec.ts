import type { OpenMeteoClient } from '../external/open-meteo.client';
import type { OverpassClient } from '../external/overpass.client';
import {
  CITY_PRICE_LEVELS,
  DEFAULT_PRICE_LEVEL,
  MAX_LODGING_ITEMS,
  createLodgingTool,
  estimateNightlyPrice,
  priceLevelFor,
} from './lodging.tool';

function errorOf(output: unknown): string | undefined {
  return (output as { error?: string }).error;
}

const VIENNA = {
  name: 'Wien',
  lat: 48.20849,
  lng: 16.37208,
  countryCode: 'AT',
};
const SACHER = {
  name: 'Hotel Sacher',
  lat: 48.203912,
  lng: 16.369934,
  kind: 'hotel',
  stars: 5,
};
const HOSTEL = { name: 'Wombats', lat: 48.21, lng: 16.37, kind: 'hostel' };
const PENSION = {
  name: 'Pension Nossek',
  lat: 48.2089,
  lng: 16.3688,
  kind: 'guest_house',
};

describe('search_lodging', () => {
  let geocoder: { geocode: jest.Mock };
  let overpass: { lodgings: jest.Mock };
  const context = { userId: 'user-a' };

  beforeEach(() => {
    geocoder = {
      geocode: jest
        .fn()
        .mockResolvedValue({ available: true, data: VIENNA, cached: true }),
    };
    overpass = {
      lodgings: jest.fn().mockResolvedValue({
        available: true,
        data: [SACHER, HOSTEL, PENSION],
        cached: true,
      }),
    };
  });

  const tool = () =>
    createLodgingTool(
      geocoder as unknown as OpenMeteoClient,
      overpass as unknown as OverpassClient,
    );

  it('liefert echte Namen mit geschätzten Preisen und markiert sie als Schätzung', async () => {
    const output = await tool().execute({ place: 'Wien' }, context);

    expect(overpass.lodgings).toHaveBeenCalledWith(48.20849, 16.37208);
    expect(output).toMatchObject({
      place: { name: 'Wien', lat: 48.20849, lng: 16.37208 },
      estimate: true,
      cached: true,
    });
    if (!('items' in output)) throw new Error('Fehler statt Ergebnis');
    expect(output.note).toMatch(/Preise geschätzt/);
    expect(output.priceBasis).toMatch(/Preisniveau Wien \(3 von 4\)/);
    expect(output.items).toEqual([
      {
        name: 'Hotel Sacher',
        kind: 'hotel',
        stars: 5,
        // auf 4 Nachkommastellen gerundet
        lat: 48.2039,
        lng: 16.3699,
        // Wien 90–170 € × 2 (5 Sterne)
        priceMinEur: 180,
        priceMaxEur: 340,
      },
      {
        name: 'Wombats',
        kind: 'hostel',
        lat: 48.21,
        lng: 16.37,
        // × 0,3: 27 → 25, 51 → 50
        priceMinEur: 25,
        priceMaxEur: 50,
      },
      {
        name: 'Pension Nossek',
        kind: 'guest_house',
        lat: 48.2089,
        lng: 16.3688,
        // × 0,7: 63 → 65, 119 → 120
        priceMinEur: 65,
        priceMaxEur: 120,
      },
    ]);
    expect(output).not.toHaveProperty('nights');
  });

  it('sortiert mit Budget passende Unterkünfte nach vorn', async () => {
    const output = await tool().execute(
      { place: 'Wien', budgetPerNightEur: 100 },
      context,
    );

    if (!('items' in output)) throw new Error('Fehler statt Ergebnis');
    expect(output.items.map((i) => [i.name, i.withinBudget])).toEqual([
      ['Wombats', true],
      ['Pension Nossek', true],
      ['Hotel Sacher', false],
    ]);
  });

  it('rechnet die Nächte aus checkIn und checkOut', async () => {
    const output = await tool().execute(
      { place: 'Wien', checkIn: '2026-10-02', checkOut: '2026-10-05' },
      context,
    );

    expect(output).toMatchObject({ nights: 3 });
  });

  it(`gibt höchstens ${MAX_LODGING_ITEMS} Unterkünfte ans Modell`, async () => {
    overpass.lodgings.mockResolvedValue({
      available: true,
      // Lange, realistische Namen mit Sternen
      data: Array.from({ length: 15 }, (_, i) => ({
        ...SACHER,
        name: `Austria Trend Hotel Schloss Wilhelminenberg ${i}`,
        lat: 48.2081234 + i / 1000,
      })),
      cached: false,
    });

    const output = await tool().execute(
      {
        place: 'Wien',
        checkIn: '2026-10-02',
        checkOut: '2026-10-05',
        budgetPerNightEur: 150,
      },
      context,
    );

    if (!('items' in output)) throw new Error('Fehler statt Ergebnis');
    expect(output.items).toHaveLength(MAX_LODGING_ITEMS);
    expect(output.cached).toBe(false);
    // Die Ausgabe passt in die Kürzung der Tool-Ergebnisse (2000 Zeichen)
    expect(JSON.stringify(output).length).toBeLessThan(2000);
  });

  it('baut Such-Links zu Booking.com und Airbnb mit Ort, Daten und Personen', async () => {
    const output = await tool().execute(
      {
        place: 'wien',
        checkIn: '2026-10-02',
        checkOut: '2026-10-05',
        guests: 3,
      },
      context,
    );

    // Der Ort kommt aus dem Geocoding ("Wien"), nicht aus der Eingabe
    expect(output).toMatchObject({
      searchLinks: {
        booking:
          'https://www.booking.com/searchresults.html?ss=Wien&checkin=2026-10-02&checkout=2026-10-05&group_adults=3&no_rooms=1',
        airbnb:
          'https://www.airbnb.de/s/Wien/homes?checkin=2026-10-02&checkout=2026-10-05&adults=3',
      },
    });
  });

  it('nimmt ohne Angaben 2 Personen und lässt die Daten weg', async () => {
    const output = await tool().execute({ place: 'Wien' }, context);

    expect(output).toMatchObject({
      searchLinks: {
        booking:
          'https://www.booking.com/searchresults.html?ss=Wien&group_adults=2&no_rooms=1',
        airbnb: 'https://www.airbnb.de/s/Wien/homes?adults=2',
      },
    });
  });

  it.each([
    [{ place: '' }, /place/],
    [{ place: 'Wien', checkIn: '2026-10-02' }, /gemeinsam/],
    [
      { place: 'Wien', checkIn: '2026-10-02', checkOut: '2026-02-30' },
      /Format/,
    ],
    [{ place: 'Wien', checkIn: '2026-10-05', checkOut: '2026-10-05' }, /nach/],
    [{ place: 'Wien', checkIn: '2026-10-01', checkOut: '2026-12-01' }, /30/],
    [{ place: 'Wien', budgetPerNightEur: -5 }, /budgetPerNightEur/],
    [{ place: 'Wien', guests: 0 }, /guests/],
    [{ place: 'Wien', guests: 2.5 }, /guests/],
    [{ place: 'Wien', guests: 40 }, /guests/],
  ])('lehnt ungültige Eingaben ab: %j', async (input, message) => {
    const output = await tool().execute(input, context);

    expect(errorOf(output)).toMatch(message);
    expect(geocoder.geocode).not.toHaveBeenCalled();
  });

  it('meldet einen unbekannten Ort als Tool-Fehler', async () => {
    geocoder.geocode.mockResolvedValue({
      available: true,
      data: null,
      cached: false,
    });

    const output = await tool().execute({ place: 'Atlantis' }, context);

    expect(errorOf(output)).toMatch(/nicht gefunden/);
    expect(overpass.lodgings).not.toHaveBeenCalled();
  });

  it('meldet einen Overpass-Ausfall mit Hinweis ans Modell', async () => {
    overpass.lodgings.mockResolvedValue({
      available: false,
      cached: false,
      error: 'overpass antwortete mit Status 504',
    });

    const output = await tool().execute({ place: 'Wien' }, context);

    expect(errorOf(output)).toMatch(/504.*ohne konkrete Unterkunft/);
  });

  it('sagt ehrlich, wenn es keine Unterkünfte gibt, und meldet trotzdem die Such-Links', async () => {
    overpass.lodgings.mockResolvedValue({
      available: true,
      data: [],
      cached: false,
    });
    const t = tool();

    const output = await t.execute({ place: 'Wien' }, context);

    expect(output).toMatchObject({ items: [] });
    expect((output as { note?: string }).note).toMatch(/keine Unterkünfte/);
    expect(t.lodging!(output)).toMatchObject({
      items: [],
      searchLinks: { booking: expect.stringContaining('ss=Wien') as string },
    });
  });

  it('liefert über die Hooks Cache-Status und die Unterkünfte für den Globus', async () => {
    const t = tool();
    const output = await t.execute({ place: 'Wien' }, context);

    expect(t.cached!(output)).toBe(true);
    const lodging = t.lodging!(output);
    expect(lodging?.place).toEqual({
      name: 'Wien',
      lat: 48.20849,
      lng: 16.37208,
    });
    expect(lodging?.items[0]).toEqual({
      name: 'Hotel Sacher',
      lat: 48.2039,
      lng: 16.3699,
      kind: 'hotel',
      priceMinEur: 180,
      priceMaxEur: 340,
    });
    expect(t.cached!({ error: 'x' })).toBeUndefined();
    expect(t.lodging!({ error: 'x' })).toBeUndefined();
    expect(t.trace!(output)).toEqual({
      metadata: { hasError: false, items: 3, cached: true },
    });
  });
});

describe('Preismodell', () => {
  it('findet das Preisniveau auch über andere Schreibweisen', () => {
    expect(priceLevelFor('Vienna').city).toBe('wien');
    expect(priceLevelFor('Lisboa').city).toBe('lissabon');
    expect(priceLevelFor('Roma').level).toBe(CITY_PRICE_LEVELS.rom);
    expect(priceLevelFor('Krakau', 'Kraków')).toEqual({
      level: DEFAULT_PRICE_LEVEL,
    });
  });

  it('rechnet Art und Sterne ein und rundet auf 5 €', () => {
    const lisbon = CITY_PRICE_LEVELS.lissabon;
    expect(estimateNightlyPrice(lisbon, 'hotel')).toEqual({
      priceMinEur: 75,
      priceMaxEur: 140,
    });
    // 4 Sterne × 1,35: 101 → 100, 189 → 190
    expect(estimateNightlyPrice(lisbon, 'hotel', 4)).toEqual({
      priceMinEur: 100,
      priceMaxEur: 190,
    });
    // Apartment × 0,9, 2 Sterne × 0,75: 50,6 → 50, 94,5 → 95
    expect(estimateNightlyPrice(lisbon, 'apartment', 2)).toEqual({
      priceMinEur: 50,
      priceMaxEur: 95,
    });
  });
});

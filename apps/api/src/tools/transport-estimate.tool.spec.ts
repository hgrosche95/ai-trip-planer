import type { OpenMeteoClient } from '../external/open-meteo.client';
import {
  MAX_TRAIN_KM,
  MIN_FLIGHT_KM,
  TRAIN_RECOMMENDED_BELOW_KM,
  createTransportEstimateTool,
  estimateTransport,
  haversineKm,
} from './transport-estimate.tool';

function errorOf(output: unknown): string | undefined {
  return (output as { error?: string }).error;
}

const BERLIN = { name: 'Berlin', lat: 52.52437, lng: 13.41053 };
const VIENNA = { name: 'Wien', lat: 48.20849, lng: 16.37208 };
const LISBON = { name: 'Lissabon', lat: 38.71667, lng: -9.13333 };

describe('haversineKm', () => {
  it('rechnet bekannte Entfernungen auf wenige km genau', () => {
    // Berlin–Wien ca. 524 km, Berlin–Lissabon ca. 2310 km Luftlinie
    expect(haversineKm(BERLIN, VIENNA)).toBeCloseTo(524, -1);
    expect(haversineKm(BERLIN, LISBON)).toBeCloseTo(2310, -1);
    expect(haversineKm(BERLIN, BERLIN)).toBe(0);
  });
});

describe('estimateTransport (Tarifmodell)', () => {
  it('empfiehlt unter 800 km die Bahn und bietet ab 300 km auch den Flug an', () => {
    const { recommended, options } = estimateTransport(524);

    expect(recommended).toBe('train');
    expect(options).toEqual([
      {
        mode: 'train',
        // 524 × 1,25
        distanceKm: 655,
        // 655 × 0,06 = 39,3 → 40; 655 × 0,18 = 117,9 → 120
        priceMinEur: 40,
        priceMaxEur: 120,
        durationHours: 6.6,
        co2Kg: 20,
      },
      {
        mode: 'flight',
        distanceKm: 524,
        // 40 + 26,2 → 65; 120 + 73,4 → 195
        priceMinEur: 65,
        priceMaxEur: 195,
        // 524 / 750 + 2,5
        durationHours: 3.2,
        co2Kg: 105,
      },
    ]);
  });

  it('empfiehlt ab 800 km den Flug', () => {
    expect(estimateTransport(TRAIN_RECOMMENDED_BELOW_KM).recommended).toBe(
      'flight',
    );
    expect(estimateTransport(TRAIN_RECOMMENDED_BELOW_KM - 1).recommended).toBe(
      'train',
    );
  });

  it('bietet kurze Strecken nur per Bahn mit Mindestpreis an', () => {
    const { options } = estimateTransport(MIN_FLIGHT_KM - 1);
    expect(options.map((o) => o.mode)).toEqual(['train']);

    const short = estimateTransport(50).options[0];
    expect(short.priceMinEur).toBe(20);
  });

  it('bietet sehr weite Strecken nur per Flug an', () => {
    const { options } = estimateTransport(MAX_TRAIN_KM + 1);
    expect(options.map((o) => o.mode)).toEqual(['flight']);
  });
});

describe('estimate_transport', () => {
  let geocoder: { geocode: jest.Mock };
  const context = { userId: 'user-a' };

  beforeEach(() => {
    geocoder = {
      geocode: jest.fn((name: string) =>
        Promise.resolve({
          available: true,
          data: name === 'Berlin' ? BERLIN : name === 'Wien' ? VIENNA : null,
          cached: true,
        }),
      ),
    };
  });

  const tool = () =>
    createTransportEstimateTool(geocoder as unknown as OpenMeteoClient);

  it('geokodiert beide Orte und liefert eine als Schätzung markierte Anreise', async () => {
    const output = await tool().execute(
      { origin: 'Berlin', destination: 'Wien' },
      context,
    );

    expect(output).toMatchObject({
      from: BERLIN,
      to: VIENNA,
      straightLineKm: 524,
      recommended: 'train',
      estimate: true,
      cached: true,
    });
    if (!('options' in output)) throw new Error('Fehler statt Ergebnis');
    expect(output.options).toEqual(estimateTransport(523.6).options);
    expect(output.note).toMatch(/Geschätzt/);
    expect(output.formula).toMatch(/Luftlinie × 1.25/);
  });

  it('liefert den Bogen für den Globus und den Cache-Status', async () => {
    const t = tool();
    const output = await t.execute(
      { origin: 'Berlin', destination: 'Wien' },
      context,
    );

    expect(t.flight!(output)).toEqual({ from: BERLIN, to: VIENNA });
    expect(t.cached!(output)).toBe(true);
    expect(t.flight!({ error: 'x' })).toBeUndefined();
  });

  it('meldet einen unbekannten Ort als Tool-Fehler', async () => {
    const output = await tool().execute(
      { origin: 'Berlin', destination: 'Atlantis' },
      context,
    );

    expect(errorOf(output)).toMatch(/"Atlantis" nicht gefunden/);
  });

  it('lehnt leere Orte und zu nahe Ziele ab', async () => {
    expect(
      await tool().execute({ origin: ' ', destination: 'Wien' }, context),
    ).toEqual({ error: 'origin darf nicht leer sein.' });

    const output = await tool().execute(
      { origin: 'Berlin', destination: 'Berlin' },
      context,
    );
    expect(errorOf(output)).toMatch(/weniger als 20 km/);
  });

  it('meldet einen Ausfall des Geocodings', async () => {
    geocoder.geocode.mockResolvedValue({
      available: false,
      cached: false,
      error: 'open-meteo nicht erreichbar: Zeitüberschreitung',
    });

    const output = await tool().execute(
      { origin: 'Berlin', destination: 'Wien' },
      context,
    );

    expect(output).toEqual({
      error: 'open-meteo nicht erreichbar: Zeitüberschreitung',
    });
  });
});

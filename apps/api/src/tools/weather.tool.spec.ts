import type { OpenMeteoClient } from '../external/open-meteo.client';
import { createWeatherTool, MAX_WEATHER_DAYS } from './weather.tool';

const LISBON = { name: 'Lissabon', lat: 38.72, lng: -9.14, countryCode: 'PT' };
const RAINY_DAY = {
  date: '2026-10-03',
  tMin: 15,
  tMax: 21,
  precipMm: 12,
  code: 63,
  label: 'Regen',
};

describe('get_weather', () => {
  let client: { geocode: jest.Mock; dailyWeather: jest.Mock };
  const context = { userId: 'user-a' };

  beforeEach(() => {
    client = {
      geocode: jest
        .fn()
        .mockResolvedValue({ available: true, data: LISBON, cached: true }),
      dailyWeather: jest.fn().mockResolvedValue({
        available: true,
        data: { source: 'forecast', days: [RAINY_DAY] },
        cached: true,
      }),
    };
  });

  const tool = () =>
    createWeatherTool(client as unknown as OpenMeteoClient, () => '2026-10-01');

  it('geokodiert den Ort und liefert das Wetter pro Tag', async () => {
    const t = tool();
    const output = await t.execute(
      { place: 'Lissabon', startDate: '2026-10-03', endDate: '2026-10-03' },
      context,
    );

    expect(client.dailyWeather).toHaveBeenCalledWith(
      38.72,
      -9.14,
      '2026-10-03',
      '2026-10-03',
    );
    expect(output).toEqual({
      place: LISBON,
      source: 'forecast',
      days: [RAINY_DAY],
      cached: true,
    });
    expect(t.cached?.(output)).toBe(true);
    expect(t.weather?.(output)).toEqual({
      place: { name: 'Lissabon', lat: 38.72, lng: -9.14 },
      source: 'forecast',
      days: [RAINY_DAY],
    });
  });

  it('ist nur ein Cache-Treffer, wenn nichts neu geholt wurde', async () => {
    client.dailyWeather.mockResolvedValue({
      available: true,
      data: { source: 'forecast', days: [RAINY_DAY] },
      cached: false,
    });

    const output = await tool().execute(
      { place: 'Lissabon', startDate: '2026-10-03', endDate: '2026-10-03' },
      context,
    );

    expect(tool().cached?.(output)).toBe(false);
  });

  it('gibt Vorjahreswerte mit Hinweis ans Modell', async () => {
    client.dailyWeather.mockResolvedValue({
      available: true,
      data: { source: 'climate', days: [RAINY_DAY] },
      cached: false,
    });

    const output = await tool().execute(
      { place: 'Lissabon', startDate: '2027-03-10', endDate: '2027-03-12' },
      context,
    );

    expect(output).toMatchObject({
      source: 'climate',
      note: expect.stringContaining('Keine Vorhersage') as unknown,
    });
  });

  it.each([
    [{ place: '', startDate: '2026-10-03', endDate: '2026-10-04' }, 'place'],
    [
      { place: 'Lissabon', startDate: '03.10.2026', endDate: '2026-10-04' },
      'YYYY-MM-DD',
    ],
    [
      { place: 'Lissabon', startDate: '2026-02-30', endDate: '2026-03-02' },
      'YYYY-MM-DD',
    ],
    [
      { place: 'Lissabon', startDate: '2026-10-05', endDate: '2026-10-04' },
      'vor startDate',
    ],
    [
      { place: 'Lissabon', startDate: '2026-10-02', endDate: '2026-10-16' },
      `${MAX_WEATHER_DAYS} Tage`,
    ],
    [
      { place: 'Lissabon', startDate: '2026-09-20', endDate: '2026-09-22' },
      'Vergangenheit',
    ],
  ])('lehnt ungültige Eingaben ab: %j', async (input, message) => {
    const output = await tool().execute(input, context);

    expect(output).toEqual({
      error: expect.stringContaining(message) as unknown,
    });
    expect(client.geocode).not.toHaveBeenCalled();
  });

  it('akzeptiert genau 14 Tage', async () => {
    const output = await tool().execute(
      { place: 'Lissabon', startDate: '2026-10-02', endDate: '2026-10-15' },
      context,
    );

    expect(output).not.toHaveProperty('error');
  });

  it('meldet einen unbekannten Ort als Tool-Fehler', async () => {
    client.geocode.mockResolvedValue({
      available: true,
      data: null,
      cached: false,
    });

    const output = await tool().execute(
      { place: 'Xyzzy', startDate: '2026-10-03', endDate: '2026-10-04' },
      context,
    );

    expect(output).toEqual({
      error: expect.stringContaining('nicht gefunden') as unknown,
    });
    expect(tool().weather?.(output)).toBeUndefined();
  });

  it('reicht einen Ausfall von Open-Meteo als Tool-Fehler durch', async () => {
    client.dailyWeather.mockResolvedValue({
      available: false,
      cached: false,
      error: 'open-meteo nicht erreichbar: Zeitüberschreitung',
    });

    const output = await tool().execute(
      { place: 'Lissabon', startDate: '2026-10-03', endDate: '2026-10-04' },
      context,
    );

    expect(output).toEqual({
      error: 'open-meteo nicht erreichbar: Zeitüberschreitung',
    });
  });
});

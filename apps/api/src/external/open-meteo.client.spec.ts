import { InMemoryExternalCache } from './external-cache';
import { OpenMeteoClient, weatherLabel } from './open-meteo.client';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

function dailyBody(dates: string[], code = 61) {
  return {
    daily: {
      time: dates,
      weather_code: dates.map(() => code),
      temperature_2m_max: dates.map(() => 22.4),
      temperature_2m_min: dates.map(() => 14.6),
      precipitation_sum: dates.map(() => 3.26),
    },
  };
}

describe('OpenMeteoClient', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  let cache: InMemoryExternalCache;
  let client: OpenMeteoClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    cache = new InMemoryExternalCache();
    // "Heute" fest auf den 1. Oktober 2026
    client = new OpenMeteoClient(cache, () => new Date('2026-10-01T09:00:00Z'));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function requestedUrl(call = 0): URL {
    return new URL((fetchMock.mock.calls[call] as [string])[0]);
  }

  describe('geocode', () => {
    it('liefert den ersten Treffer mit Koordinaten auf Deutsch', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          results: [
            {
              name: 'Lissabon',
              latitude: 38.71667,
              longitude: -9.13333,
              country_code: 'PT',
              timezone: 'Europe/Lisbon',
            },
          ],
        }),
      );

      const result = await client.geocode(' Lissabon ');

      expect(result).toEqual({
        available: true,
        cached: false,
        data: {
          name: 'Lissabon',
          lat: 38.71667,
          lng: -9.13333,
          countryCode: 'PT',
          timezone: 'Europe/Lisbon',
        },
      });
      const url = requestedUrl();
      expect(url.host).toBe('geocoding-api.open-meteo.com');
      expect(url.searchParams.get('name')).toBe('Lissabon');
      expect(url.searchParams.get('language')).toBe('de');
      expect([...cache.entries.keys()]).toEqual([
        'open-meteo:geocode:lissabon',
      ]);
    });

    it('liefert null, wenn der Ort unbekannt ist', async () => {
      // Ohne Treffer fehlt das Feld results ganz
      fetchMock.mockResolvedValue(jsonResponse({ generationtime_ms: 0.3 }));

      const result = await client.geocode('Xyzzy');

      expect(result).toEqual({ available: true, cached: false, data: null });
    });

    it('meldet einen Ausfall als nicht verfügbar', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, 500));

      const result = await client.geocode('Lissabon');

      expect(result.available).toBe(false);
    });
  });

  describe('dailyWeather', () => {
    it('nutzt innerhalb von 16 Tagen die Vorhersage', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(dailyBody(['2026-10-03', '2026-10-04'])),
      );

      const result = await client.dailyWeather(
        38.71667,
        -9.13333,
        '2026-10-03',
        '2026-10-04',
      );

      const url = requestedUrl();
      expect(url.host).toBe('api.open-meteo.com');
      expect(url.pathname).toBe('/v1/forecast');
      expect(url.searchParams.get('latitude')).toBe('38.72');
      expect(url.searchParams.get('longitude')).toBe('-9.13');
      expect(url.searchParams.get('timezone')).toBe('auto');
      expect(url.searchParams.get('daily')).toBe(
        'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum',
      );
      expect(result).toEqual({
        available: true,
        cached: false,
        data: {
          source: 'forecast',
          days: [
            {
              date: '2026-10-03',
              tMin: 15,
              tMax: 22,
              precipMm: 3.3,
              code: 61,
              label: 'Leichter Regen',
            },
            {
              date: '2026-10-04',
              tMin: 15,
              tMax: 22,
              precipMm: 3.3,
              code: 61,
              label: 'Leichter Regen',
            },
          ],
        },
      });
    });

    it('der 16. Tag ab heute ist noch Vorhersage, der 17. nicht mehr', async () => {
      fetchMock.mockResolvedValue(jsonResponse(dailyBody(['2026-10-16'])));

      await client.dailyWeather(38.7, -9.1, '2026-10-16', '2026-10-16');
      await client.dailyWeather(38.7, -9.1, '2026-10-17', '2026-10-17');

      expect(requestedUrl(0).pathname).toBe('/v1/forecast');
      expect(requestedUrl(1).host).toBe('archive-api.open-meteo.com');
    });

    it('nutzt weiter in der Zukunft den Vorjahreszeitraum und markiert ihn als climate', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(dailyBody(['2026-03-10', '2026-03-11'], 0)),
      );

      const result = await client.dailyWeather(
        38.72,
        -9.14,
        '2027-03-10',
        '2027-03-11',
      );

      const url = requestedUrl();
      expect(url.host).toBe('archive-api.open-meteo.com');
      expect(url.pathname).toBe('/v1/archive');
      expect(url.searchParams.get('start_date')).toBe('2026-03-10');
      expect(url.searchParams.get('end_date')).toBe('2026-03-11');
      expect(result.available && result.data.source).toBe('climate');
      // Angezeigt werden die Reisetage, nicht die Daten des Vorjahrs
      expect(result.available && result.data.days.map((d) => d.date)).toEqual([
        '2027-03-10',
        '2027-03-11',
      ]);
    });

    it('rechnet den 29. Februar im Vorjahr auf den 28. zurück', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(dailyBody(['2027-02-28', '2027-03-01'])),
      );

      await client.dailyWeather(38.72, -9.14, '2028-02-29', '2028-03-01');

      expect(requestedUrl().searchParams.get('start_date')).toBe('2027-02-28');
      expect(requestedUrl().searchParams.get('end_date')).toBe('2027-03-01');
    });

    it('trifft bei leicht anderen Koordinaten denselben Cache-Eintrag', async () => {
      fetchMock.mockResolvedValue(jsonResponse(dailyBody(['2026-10-03'])));

      await client.dailyWeather(38.7223, -9.1393, '2026-10-03', '2026-10-03');
      const second = await client.dailyWeather(
        38.7201,
        -9.1402,
        '2026-10-03',
        '2026-10-03',
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(second.cached).toBe(true);
      expect([...cache.entries.keys()]).toEqual([
        'open-meteo:forecast:38.72,-9.14:2026-10-03:2026-10-03',
      ]);
    });

    it('lässt Tage ohne Messwerte weg, statt 0 °C zu erfinden', async () => {
      const body = dailyBody(['2026-10-03', '2026-10-04']);
      body.daily.temperature_2m_max[1] = null as unknown as number;
      fetchMock.mockResolvedValue(jsonResponse(body));

      const result = await client.dailyWeather(
        38.72,
        -9.14,
        '2026-10-03',
        '2026-10-04',
      );

      expect(result.available && result.data.days).toHaveLength(1);
    });

    it('meldet eine unerwartete Antwort als nicht verfügbar', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: true, reason: 'x' }));

      const result = await client.dailyWeather(
        38.72,
        -9.14,
        '2026-10-03',
        '2026-10-04',
      );

      expect(result.available).toBe(false);
      expect(cache.entries.size).toBe(0);
    });
  });

  it('übersetzt WMO-Codes in kurze deutsche Texte', () => {
    expect(weatherLabel(0)).toBe('Klar');
    expect(weatherLabel(3)).toBe('Bedeckt');
    expect(weatherLabel(81)).toBe('Regenschauer');
    expect(weatherLabel(95)).toBe('Gewitter');
    expect(weatherLabel(42)).toBe('Unbekannt');
  });
});

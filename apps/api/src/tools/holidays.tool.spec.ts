import type { NagerDateClient } from '../external/nager-date.client';
import type { OpenMeteoClient } from '../external/open-meteo.client';
import { createHolidaysTool } from './holidays.tool';

function setup(countryCode: string | undefined = 'pt') {
  const geocoder = {
    geocode: jest.fn(() =>
      Promise.resolve({
        available: true,
        cached: true,
        data: { name: 'Lissabon', lat: 38.72, lng: -9.14, countryCode },
      }),
    ),
  };
  const client = {
    holidays: jest.fn((year: number) =>
      Promise.resolve({
        available: true,
        cached: true,
        data:
          year === 2026
            ? [
                {
                  date: '2026-12-08',
                  localName: 'Imaculada Conceição',
                  name: 'x',
                },
                { date: '2026-12-25', localName: 'Natal', name: 'Christmas' },
              ]
            : [{ date: '2027-01-01', localName: 'Ano Novo', name: 'x' }],
      }),
    ),
  };
  const tool = createHolidaysTool(
    geocoder as unknown as OpenMeteoClient,
    client as unknown as NagerDateClient,
  );
  return { tool, geocoder, client };
}

describe('get_public_holidays', () => {
  it('liefert nur Feiertage im Zeitraum, auch über den Jahreswechsel', async () => {
    const { tool, client } = setup();

    const output = await tool.execute(
      { place: 'Lissabon', startDate: '2026-12-24', endDate: '2027-01-02' },
      { userId: 'u' },
    );

    expect(output).toEqual({
      place: { name: 'Lissabon', lat: 38.72, lng: -9.14 },
      countryCode: 'PT',
      holidays: [
        { date: '2026-12-25', name: 'Natal' },
        { date: '2027-01-01', name: 'Ano Novo' },
      ],
      cached: true,
    });
    expect(client.holidays.mock.calls).toEqual([
      [2026, 'PT'],
      [2027, 'PT'],
    ]);
  });

  it('meldet Fehler statt zu werfen: ungültiger Zeitraum, Land unbekannt', async () => {
    const { tool } = setup('');
    expect(
      await tool.execute(
        { place: 'Lissabon', startDate: '2026-10-16', endDate: '2026-10-14' },
        { userId: 'u' },
      ),
    ).toHaveProperty('error');
    expect(
      await tool.execute(
        { place: 'Atlantis', startDate: '2026-10-14', endDate: '2026-10-16' },
        { userId: 'u' },
      ),
    ).toEqual({ error: 'Land von "Atlantis" unbekannt.' });
  });
});

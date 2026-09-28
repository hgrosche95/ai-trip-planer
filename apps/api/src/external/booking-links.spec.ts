import { lodgingSearchLinks } from './booking-links';

describe('lodgingSearchLinks', () => {
  it('baut die Suche mit Ort, Daten und Personenzahl', () => {
    expect(
      lodgingSearchLinks({
        city: 'Wien',
        checkIn: '2026-10-02',
        checkOut: '2026-10-05',
        guests: 3,
      }),
    ).toEqual({
      booking:
        'https://www.booking.com/searchresults.html?ss=Wien&checkin=2026-10-02&checkout=2026-10-05&group_adults=3&no_rooms=1',
      airbnb:
        'https://www.airbnb.de/s/Wien/homes?checkin=2026-10-02&checkout=2026-10-05&adults=3',
    });
  });

  it('lässt ohne Daten die Datums-Parameter weg und nimmt 2 Personen an', () => {
    expect(lodgingSearchLinks({ city: 'Rom' })).toEqual({
      booking:
        'https://www.booking.com/searchresults.html?ss=Rom&group_adults=2&no_rooms=1',
      airbnb: 'https://www.airbnb.de/s/Rom/homes?adults=2',
    });
  });

  it('maskiert Sonderzeichen in Ort und Pfad', () => {
    const links = lodgingSearchLinks({ city: 'São Paulo/Centro & mehr?x=1' });

    expect(new URL(links.booking).searchParams.get('ss')).toBe(
      'São Paulo/Centro & mehr?x=1',
    );
    expect(links.airbnb).toBe(
      'https://www.airbnb.de/s/S%C3%A3o%20Paulo%2FCentro%20%26%20mehr%3Fx%3D1/homes?adults=2',
    );
    // Pfad bleibt ein Segment, die Abfrage bleibt unverändert
    const airbnb = new URL(links.airbnb);
    expect(airbnb.pathname.split('/')).toHaveLength(4);
    expect([...airbnb.searchParams.keys()]).toEqual(['adults']);
  });

  it('hängt keine Affiliate- oder Tracking-Parameter an', () => {
    const links = lodgingSearchLinks({
      city: 'Lissabon',
      checkIn: '2026-10-02',
      checkOut: '2026-10-04',
    });

    expect([...new URL(links.booking).searchParams.keys()]).toEqual([
      'ss',
      'checkin',
      'checkout',
      'group_adults',
      'no_rooms',
    ]);
    expect([...new URL(links.airbnb).searchParams.keys()]).toEqual([
      'checkin',
      'checkout',
      'adults',
    ]);
  });
});

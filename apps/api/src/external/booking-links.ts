// Such-Links zu Booking.com und Airbnb. Kein API-Zugriff: Airbnb hat keine
// öffentliche API, Booking.com und Expedia geben ihre nur an freigeschaltete
// Partner. Ein Link auf die Suchseite mit Ort, Daten und Personenzahl zeigt
// dem Nutzer die echten Preise und die Verfügbarkeit, ohne dass wir sie
// kennen oder erfinden müssen. Bewusst ohne Affiliate- oder Tracking-Parameter.

export interface LodgingSearchLinks {
  booking: string;
  airbnb: string;
}

export interface LodgingSearch {
  city: string;
  // YYYY-MM-DD, nur gemeinsam; ohne Daten zeigen beide Seiten die Suche ohne Zeitraum
  checkIn?: string;
  checkOut?: string;
  guests?: number;
}

const BOOKING_SEARCH_URL = 'https://www.booking.com/searchresults.html';
const AIRBNB_SEARCH_URL = 'https://www.airbnb.de/s';
export const DEFAULT_GUESTS = 2;

export function lodgingSearchLinks({
  city,
  checkIn,
  checkOut,
  guests = DEFAULT_GUESTS,
}: LodgingSearch): LodgingSearchLinks {
  const withDates = checkIn !== undefined && checkOut !== undefined;
  const adults = String(guests);

  const booking = new URLSearchParams({ ss: city });
  if (withDates) {
    booking.set('checkin', checkIn);
    booking.set('checkout', checkOut);
  }
  booking.set('group_adults', adults);
  booking.set('no_rooms', '1');

  const airbnb = new URLSearchParams();
  if (withDates) {
    airbnb.set('checkin', checkIn);
    airbnb.set('checkout', checkOut);
  }
  airbnb.set('adults', adults);

  return {
    booking: `${BOOKING_SEARCH_URL}?${booking}`,
    // Der Ort steht bei Airbnb im Pfad: encodeURIComponent maskiert auch "/"
    airbnb: `${AIRBNB_SEARCH_URL}/${encodeURIComponent(city)}/homes?${airbnb}`,
  };
}

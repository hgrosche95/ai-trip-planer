import { seedFromItinerary, seededDraftView } from './itinerary-seed';
import type { SavedItinerary } from './itinerary-seed';
import { emptyFindings } from './trip-draft';

function saved(overrides: Partial<SavedItinerary> = {}): SavedItinerary {
  return {
    id: 'trip-1',
    destination: 'Lissabon',
    startDate: new Date('2026-10-14T00:00:00Z'),
    endDate: new Date('2026-10-16T00:00:00Z'),
    budgetCents: 80_000,
    currency: 'EUR',
    preferences: ['Essen'],
    budgetReport: {
      currency: 'EUR',
      limitCents: 80_000,
      totalCents: 70_000,
      status: 'ok',
      items: [{ category: 'food', cents: 10_000 }],
    },
    assumptions: ['Unterkunft: Mittelklasse'],
    travelers: 2,
    origin: 'Berlin',
    lodging: 'mid',
    stops: [
      {
        dayNumber: 1,
        order: 1,
        title: 'Alfama',
        description: null,
        category: 'SIGHTSEEING',
        costCents: null,
        lat: 38.71,
        lng: -9.13,
      },
      {
        dayNumber: 2,
        order: 1,
        title: 'Freizeit',
        description: 'Treiben lassen',
        category: 'OTHER',
        costCents: 0,
        lat: null,
        lng: null,
      },
    ],
    ...overrides,
  };
}

describe('seedFromItinerary', () => {
  it('macht aus einer Reise aus dem Multi-Modus den Entwurf mit allen Eckdaten', () => {
    const seed = seedFromItinerary(saved());

    expect(seed).toMatchObject({
      revision: 1,
      itineraryId: 'trip-1',
      seeded: true,
      findings: emptyFindings(),
      budget: { limitCents: 80_000, totalCents: 70_000 },
    });
    expect(seed.brief).toEqual({
      destination: 'Lissabon',
      origin: 'Berlin',
      startDate: '2026-10-14',
      endDate: '2026-10-16',
      datesAssumed: false,
      travelers: 2,
      budget: { amount: 800, currency: 'EUR' },
      preferences: ['Essen'],
      lodging: 'mid',
      assumptions: ['Unterkunft: Mittelklasse'],
    });
    // null aus der Datenbank wird zu "nicht gesetzt"
    expect(seed.draft.stops).toEqual([
      {
        dayNumber: 1,
        order: 1,
        title: 'Alfama',
        category: 'SIGHTSEEING',
        lat: 38.71,
        lng: -9.13,
      },
      {
        dayNumber: 2,
        order: 1,
        title: 'Freizeit',
        description: 'Treiben lassen',
        category: 'OTHER',
        costCents: 0,
      },
    ]);
  });

  it('Klassik-Plan ohne Eckdaten: 1 Person als Annahme, Budget aus dem Plan', () => {
    const seed = seedFromItinerary(
      saved({
        budgetReport: null,
        assumptions: [],
        travelers: null,
        origin: null,
        lodging: null,
        budgetCents: 50_000,
      }),
    );

    expect(seed.brief.travelers).toBe(1);
    expect(seed.brief.origin).toBeUndefined();
    expect(seed.brief.lodging).toBeUndefined();
    expect(seed.brief.budget).toEqual({ amount: 500, currency: 'EUR' });
    expect(seed.brief.assumptions).toEqual([
      'Personenzahl nicht gespeichert: 1 Person angenommen',
    ]);
    expect(seed.budget).toBeUndefined();
  });

  it('ohne genanntes Budget im Bericht bleibt die Reise ohne Budget', () => {
    const seed = seedFromItinerary(
      saved({
        budgetReport: {
          currency: 'EUR',
          limitCents: null,
          totalCents: 70_000,
          status: 'ok',
          items: [],
        },
      }),
    );
    expect(seed.brief.budget).toBeUndefined();
  });

  it('seededDraftView liefert den Entwurf in der Form von itinerary.draft', () => {
    const view = seededDraftView(seedFromItinerary(saved()));
    expect(view).toMatchObject({
      itineraryId: 'trip-1',
      revision: 1,
      assumptions: ['Unterkunft: Mittelklasse'],
      budget: { totalCents: 70_000 },
      itinerary: {
        destination: 'Lissabon',
        startDate: '2026-10-14',
        endDate: '2026-10-16',
        travelers: 2,
        origin: 'Berlin',
        lodging: 'mid',
      },
    });
    expect(view.itinerary.stops).toHaveLength(2);
  });
});

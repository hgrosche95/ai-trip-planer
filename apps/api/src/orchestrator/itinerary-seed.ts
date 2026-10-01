import type { BudgetReport } from './agents/budget.agent';
import { emptyFindings, LODGING_LEVELS, MAX_TRIP_DAYS } from './trip-draft';
import type { DraftStop, TripBrief } from './trip-draft';
import type { StoredTripDraft } from './trip-draft-store';
import type { ItineraryDraft } from '../runs/run-events';

// "Im Chat bearbeiten": Aus einer gespeicherten Reise wird wieder der
// Entwurf einer Chat-Session, als wäre er gerade entstanden. Folgenachrichten
// laufen danach durch dieselbe Überarbeitung wie im Chat (triage → revise).
//
// Was die Reise nicht kennt, ergänzt der Code: ohne gespeicherte Personenzahl
// 1 Person (als Annahme genannt), die Recherche (Wetter, Unterkünfte, …)
// fehlt ganz. seeded sagt dem Orchestrator, dass die erste Änderung sie
// vollständig nachholt.

// Was GET /itineraries/:id aus der Datenbank liefert, soweit hier gebraucht
export interface SavedItinerary {
  id: string;
  destination: string;
  startDate: Date;
  endDate: Date;
  budgetCents: number;
  currency: string;
  preferences: string[];
  budgetReport: unknown;
  assumptions: string[];
  travelers: number | null;
  origin: string | null;
  lodging: string | null;
  stops: {
    dayNumber: number;
    order: number;
    title: string;
    description: string | null;
    category: DraftStop['category'];
    costCents: number | null;
    lat: number | null;
    lng: number | null;
  }[];
}

// Was das Frontend braucht, um den Entwurf sofort auf der Arbeitsfläche zu
// zeigen (dieselbe Form wie itinerary.draft und budget.updated)
export interface SeededDraft {
  itineraryId: string;
  revision: number;
  itinerary: ItineraryDraft;
  assumptions: string[];
  budget?: BudgetReport;
}

const MAX_ASSUMPTIONS = 6;

export function seedFromItinerary(saved: SavedItinerary): StoredTripDraft {
  const startDate = isoDay(saved.startDate);
  const endDate = isoDay(saved.endDate);
  const report = budgetReportOf(saved.budgetReport);
  const lodging = LODGING_LEVELS.find((level) => level === saved.lodging);

  const assumptions = [...saved.assumptions];
  if (saved.travelers === null) {
    assumptions.push('Personenzahl nicht gespeichert: 1 Person angenommen');
  }

  const brief: TripBrief = {
    destination: saved.destination,
    ...(saved.origin && { origin: saved.origin }),
    startDate,
    endDate,
    datesAssumed: false,
    travelers: saved.travelers ?? 1,
    ...budgetOf(saved, report),
    preferences: [...saved.preferences],
    ...(lodging && { lodging }),
    assumptions: assumptions.slice(0, MAX_ASSUMPTIONS),
  };

  const stops: DraftStop[] = saved.stops
    .filter((stop) => stop.dayNumber <= MAX_TRIP_DAYS)
    .map((stop) => ({
      dayNumber: stop.dayNumber,
      order: stop.order,
      title: stop.title,
      ...(stop.description !== null && { description: stop.description }),
      ...(stop.category && { category: stop.category }),
      ...(stop.costCents !== null && { costCents: stop.costCents }),
      ...(stop.lat !== null && { lat: stop.lat }),
      ...(stop.lng !== null && { lng: stop.lng }),
    }));

  return {
    revision: 1,
    brief,
    draft: {
      destination: saved.destination,
      startDate,
      endDate,
      budgetCents: saved.budgetCents,
      currency: saved.currency,
      preferences: [...saved.preferences],
      stops,
    },
    findings: emptyFindings(),
    ...(report && { budget: report }),
    itineraryId: saved.id,
    seeded: true,
  };
}

// Antwort von POST /itineraries/:id/edit
export function seededDraftView(stored: StoredTripDraft): SeededDraft {
  const { draft, brief } = stored;
  return {
    itineraryId: stored.itineraryId!,
    revision: stored.revision,
    itinerary: {
      destination: draft.destination,
      startDate: draft.startDate,
      endDate: draft.endDate,
      budgetCents: draft.budgetCents,
      currency: draft.currency,
      preferences: [...(draft.preferences ?? [])],
      travelers: brief.travelers,
      ...(brief.origin && { origin: brief.origin }),
      ...(brief.lodging && { lodging: brief.lodging }),
      stops: draft.stops.map((stop) => ({ ...stop })),
    },
    assumptions: [...brief.assumptions],
    ...(stored.budget && { budget: stored.budget }),
  };
}

// Das genannte Budget: aus dem Budgetbericht (Multi-Modus), sonst das
// Budget des Plans (Klassik-Modus speichert dort das genannte). Ohne beides
// gilt die Reise als ohne Budget geplant.
function budgetOf(
  saved: SavedItinerary,
  report: BudgetReport | undefined,
): Pick<TripBrief, 'budget'> {
  if (report) {
    return report.limitCents
      ? { budget: { amount: report.limitCents / 100, currency: 'EUR' } }
      : {};
  }
  return saved.budgetCents > 0
    ? {
        budget: {
          amount: saved.budgetCents / 100,
          currency: saved.currency.toUpperCase(),
        },
      }
    : {};
}

function budgetReportOf(value: unknown): BudgetReport | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const report = value as Partial<BudgetReport>;
  return typeof report.totalCents === 'number' && Array.isArray(report.items)
    ? (value as BudgetReport)
    : undefined;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

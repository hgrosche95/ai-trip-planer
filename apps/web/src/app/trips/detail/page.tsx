'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import BudgetBar from '@/components/budget-bar';
import { authFetch } from '@/lib/auth';
import type { BudgetReport } from '@/lib/run-events';
import CityMap from '@/components/city-map';
import DayTicket, { StopNumber } from '@/components/day-ticket';
import { dayDate } from '@/lib/draft-days';
import { formatDate, formatMoney, placeCode, tripDays } from '@/lib/format';
import DeleteTripButton from './delete-trip-button';
import DeleteStopButton from './delete-stop-button';

interface Stop {
  id: string;
  dayNumber: number;
  order: number;
  title: string;
  description: string | null;
  category: string;
  costCents: number | null;
  lat: number | null;
  lng: number | null;
}

interface ItineraryDetail {
  id: string;
  destination: string;
  startDate: string;
  endDate: string;
  budgetCents: number;
  currency: string;
  preferences: string[];
  stops: Stop[];
  // Aus dem Entwurf mitgespeichert; fehlt bei älteren und Klassik-Plänen
  budgetReport?: BudgetReport | null;
  assumptions?: string[];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL;

const CATEGORY_STAMPS: Record<string, { label: string; className: string }> = {
  FOOD: { label: 'Essen', className: 'text-stamp dark:text-red-400' },
  CULTURE: { label: 'Kultur', className: 'text-purple-700 dark:text-purple-300' },
  SIGHTSEEING: { label: 'Sehenswert', className: 'text-teal dark:text-teal-300' },
  ACCOMMODATION: { label: 'Unterkunft', className: 'text-navy dark:text-blue-300' },
  TRANSPORT: { label: 'Transport', className: 'text-amber-700 dark:text-amber-400' },
  OTHER: { label: 'Sonstiges', className: 'text-dim' },
};

function CategoryStamp({ category }: { category: string }) {
  const stamp = CATEGORY_STAMPS[category] ?? CATEGORY_STAMPS.OTHER;
  return (
    <span
      className={`shrink-0 -rotate-3 rounded-sm border-[1.5px] border-current px-1.5 py-px font-mono text-[11px] font-semibold uppercase tracking-wider ${stamp.className}`}
    >
      {stamp.label}
    </span>
  );
}

// Ladefehler mit Ausweg: erneut versuchen oder zurück zur Liste
function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="mx-auto w-full max-w-2xl p-4">
      <h1 className="text-2xl font-extrabold">Reise</h1>
      <p role="alert" className="mt-2 text-sm text-dim">
        {message}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="min-h-10 rounded-lg bg-navy px-4 text-sm font-semibold text-white dark:bg-foreground dark:text-background"
          >
            Erneut laden
          </button>
        )}
        <Link
          href="/trips"
          className="inline-flex min-h-10 items-center rounded-lg border border-rule px-4 text-sm font-semibold"
        >
          Zu Meine Reisen
        </Link>
      </div>
    </div>
  );
}

async function fetchItinerary(id: string): Promise<ItineraryDetail> {
  const res = await authFetch(`${API_URL}/itineraries/${id}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`, { cause: res.status });
  return res.json();
}

function loadErrorMessage(error: unknown) {
  return error instanceof Error && error.cause === 404
    ? 'Diese Reise gibt es nicht (mehr).'
    : 'Die Reise konnte gerade nicht geladen werden. Versuch es bitte gleich noch einmal.';
}

function TripDetailSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-2xl p-4 motion-safe:animate-pulse"
      role="status"
      aria-label="Reise wird geladen"
    >
      <div className="h-8 w-48 rounded bg-rule" />
      <div className="mt-2 h-3 w-56 rounded bg-rule" />
      <div className="mt-4 h-16 rounded-xl border border-rule bg-card" />
      <div className="mt-6 flex flex-col gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="grid h-36 grid-cols-[5rem_1fr] rounded-xl bg-card">
            <div className="rounded-l-xl border-r-2 border-dashed border-rule bg-rule/40" />
          </div>
        ))}
      </div>
    </div>
  );
}

function TripDetail() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get('id');

  const [itinerary, setItinerary] = useState<ItineraryDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ message: string; retry: boolean } | null>(null);
  // Tag unter der Maus: auf der Karte hervorgehoben
  const [hoverDay, setHoverDay] = useState<number | null>(null);

  const showLoadError = useCallback(
    (error: unknown) =>
      setLoadError({
        message: loadErrorMessage(error),
        retry: !(error instanceof Error && error.cause === 404),
      }),
    [],
  );

  const loadItinerary = useCallback(() => {
    if (!id) return;
    fetchItinerary(id).then(setItinerary, showLoadError);
  }, [id, showLoadError]);

  function retry() {
    if (!id) return;
    setLoadError(null);
    setIsLoading(true);
    fetchItinerary(id)
      .then(setItinerary, showLoadError)
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    if (!id) return;
    fetchItinerary(id)
      .then(setItinerary, showLoadError)
      .finally(() => setIsLoading(false));
  }, [id, showLoadError]);

  if (!id) {
    return <LoadError message="Keine Reise ausgewählt." />;
  }

  if (loadError) {
    return <LoadError message={loadError.message} onRetry={loadError.retry ? retry : undefined} />;
  }

  if (isLoading || !itinerary) {
    return <TripDetailSkeleton />;
  }

  const days = Array.from(new Set(itinerary.stops.map((s) => s.dayNumber))).sort(
    (a, b) => a - b,
  );

  const plannedCents = itinerary.stops.reduce((sum, stop) => sum + (stop.costCents ?? 0), 0);
  const percent =
    itinerary.budgetCents > 0 ? (plannedCents / itinerary.budgetCents) * 100 : 0;
  const isOverBudget = percent > 100;
  const tripLength = tripDays(itinerary.startDate, itinerary.endDate);
  const hasMap = itinerary.stops.some((stop) => stop.lat != null && stop.lng != null);

  const report = itinerary.budgetReport;
  const assumptions = itinerary.assumptions ?? [];

  return (
    <div className="mx-auto w-full max-w-2xl p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-3xl font-semibold tracking-wider">
              {placeCode(itinerary.destination)}
            </span>
            <h1 className="text-2xl font-extrabold">{itinerary.destination}</h1>
          </div>
          <p className="mt-1 font-mono text-xs text-dim">
            {formatDate(itinerary.startDate)} – {formatDate(itinerary.endDate)} · {tripLength}{' '}
            {tripLength === 1 ? 'TAG' : 'TAGE'}
          </p>
        </div>
        <DeleteTripButton
          itineraryId={itinerary.id}
          destination={itinerary.destination}
          onDeleted={() => router.push('/trips')}
        />
      </div>

      {report ? (
        // Dieselbe Schätzung wie im Entwurf: Anreise, Unterkunft, Programm, Essen
        <div className="mt-4 rounded-xl border border-rule bg-card px-4 pb-4 pt-1">
          <BudgetBar report={report} />
          {assumptions.length > 0 && (
            <section aria-label="Annahmen" className="mt-3">
              <h2 className="mb-1 font-mono text-[11px] uppercase tracking-wider text-dim">
                Annahmen
              </h2>
              <ul className="list-disc space-y-0.5 pl-5 text-sm">
                {assumptions.map((assumption) => (
                  <li key={assumption}>{assumption}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-rule bg-card p-4">
          <div className="flex justify-between gap-3 font-mono text-xs">
            <span className="uppercase tracking-wider text-dim">Programmpunkte</span>
            <span className={`font-semibold tabular-nums ${isOverBudget ? 'text-stamp' : ''}`}>
              {formatMoney(plannedCents, itinerary.currency)} /{' '}
              {formatMoney(itinerary.budgetCents, itinerary.currency)}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-rule">
            <div
              className={`h-full rounded-full ${isOverBudget ? 'bg-stamp' : 'bg-teal'}`}
              style={{ width: `${Math.min(percent, 100)}%` }}
            />
          </div>
          {isOverBudget ? (
            <p className="mt-2 text-xs text-stamp">
              Budget um {formatMoney(plannedCents - itinerary.budgetCents, itinerary.currency)}{' '}
              überschritten.
            </p>
          ) : (
            <p className="mt-2 text-xs text-dim">Nur die Programmpunkte, ohne Anreise und Unterkunft.</p>
          )}
        </div>
      )}

      {hasMap && (
        <div className="mt-4 h-64 overflow-hidden rounded-xl border border-rule bg-card sm:h-80">
          <CityMap stops={itinerary.stops} activeDay={hoverDay} />
        </div>
      )}

      <div className="mt-6 flex flex-col gap-4">
        {days.map((day) => (
          <DayTicket
            key={day}
            dayNumber={day}
            date={dayDate(itinerary.startDate, day)}
            dimmed={hoverDay !== null && hoverDay !== day}
            onHover={setHoverDay}
            headingLevel={2}
          >
            <ol className="flex flex-col px-3.5 py-1">
              {itinerary.stops
                .filter((stop) => stop.dayNumber === day)
                .map((stop, index) => (
                  <li key={stop.id} className="flex gap-2.5 border-b border-rule py-3 last:border-b-0">
                    <StopNumber dayNumber={day} index={index} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <span className="font-bold leading-snug">{stop.title}</span>
                        <CategoryStamp category={stop.category} />
                      </div>
                      {stop.description && <p className="mt-0.5 text-sm text-dim">{stop.description}</p>}
                      <div className="mt-1.5 flex items-center justify-between">
                        <span className="font-mono text-sm tabular-nums text-dim">
                          {stop.costCents == null
                            ? '–'
                            : stop.costCents === 0
                              ? 'frei'
                              : formatMoney(stop.costCents, itinerary.currency)}
                        </span>
                        <DeleteStopButton
                          itineraryId={itinerary.id}
                          stopId={stop.id}
                          stopTitle={stop.title}
                          onDeleted={loadItinerary}
                        />
                      </div>
                    </div>
                  </li>
                ))}
            </ol>
          </DayTicket>
        ))}
      </div>
    </div>
  );
}

export default function TripDetailPage() {
  return (
    <Suspense fallback={<TripDetailSkeleton />}>
      <TripDetail />
    </Suspense>
  );
}

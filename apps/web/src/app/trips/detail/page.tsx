'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authFetch } from '@/lib/auth';
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
      className={`shrink-0 -rotate-3 rounded-sm border-[1.5px] border-current px-1.5 py-px font-mono text-[9px] font-semibold uppercase tracking-widest ${stamp.className}`}
    >
      {stamp.label}
    </span>
  );
}

function weekdayOf(startIso: string, dayNumber: number) {
  const date = new Date(startIso);
  date.setDate(date.getDate() + dayNumber - 1);
  return date.toLocaleDateString('de-DE', { weekday: 'short' });
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
      <div className="mt-6 grid grid-cols-[3rem_1fr] gap-3">
        <div className="min-h-32 border-r-2 border-rule" />
        <div className="flex flex-col gap-2">
          <div className="h-20 rounded-lg border border-rule bg-card" />
          <div className="h-20 rounded-lg border border-rule bg-card" />
        </div>
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

  const loadItinerary = useCallback(async () => {
    if (!id) return;
    const res = await authFetch(`${API_URL}/itineraries/${id}`, { cache: 'no-store' });
    setItinerary(await res.json());
    setIsLoading(false);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    authFetch(`${API_URL}/itineraries/${id}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        setItinerary(data);
        setIsLoading(false);
      });
  }, [id]);

  if (!id) {
    return <p className="mx-auto max-w-2xl p-4 text-sm text-zinc-500">Keine Reise ausgewählt.</p>;
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

    return (
    <div className="mx-auto w-full max-w-2xl p-4">
      <div className="flex items-start justify-between gap-4">
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
        <DeleteTripButton itineraryId={itinerary.id} onDeleted={() => router.push('/trips')} />
      </div>

      <div className="mt-4 rounded-xl border border-rule bg-card p-4">
        <div className="flex justify-between font-mono text-xs">
          <span className="uppercase tracking-widest text-dim">Verplant</span>
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
        {isOverBudget && (
          <p className="mt-2 text-xs text-stamp">
            Budget um {formatMoney(plannedCents - itinerary.budgetCents, itinerary.currency)}{' '}
            überschritten.
          </p>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-6">
        {days.map((day) => (
          <section key={day} className="grid grid-cols-[3rem_1fr] gap-3">
                        <div className="border-r-2 border-foreground pr-2 text-center font-mono text-[10px] uppercase text-dim">
              <h2>
                Tag{' '}
                <span className="block text-2xl font-bold leading-none text-foreground">{day}</span>
              </h2>
              {weekdayOf(itinerary.startDate, day)}
            </div>
            <ul className="flex flex-col gap-2">
              {itinerary.stops
                .filter((stop) => stop.dayNumber === day)
                .map((stop) => (
                  <li key={stop.id} className="rounded-lg border border-rule bg-card p-3">
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-bold">{stop.title}</span>
                      <CategoryStamp category={stop.category} />
                    </div>
                    {stop.description && (
                      <p className="mt-0.5 text-sm text-dim">{stop.description}</p>
                    )}
                    <div className="mt-2 flex items-center justify-between">
                      <span className="font-mono text-sm tabular-nums">
                        {stop.costCents != null
                          ? formatMoney(stop.costCents, itinerary.currency)
                          : '–'}
                      </span>
                      <DeleteStopButton
                        itineraryId={itinerary.id}
                        stopId={stop.id}
                        onDeleted={loadItinerary}
                      />
                    </div>
                  </li>
                ))}
            </ul>
          </section>
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

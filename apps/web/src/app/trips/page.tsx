'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/auth';
import { formatDate, formatMoney, placeCode, tripDays } from '@/lib/format';

interface Itinerary {
  id: string;
  destination: string;
  startDate: string;
  endDate: string;
  budgetCents: number;
  currency: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL;

function BoardingPass({ itinerary }: { itinerary: Itinerary }) {
  const days = tripDays(itinerary.startDate, itinerary.endDate);

  return (
    <Link
      href={`/trips/detail?id=${itinerary.id}`}
      className="grid grid-cols-[1fr_auto] overflow-hidden rounded-xl border border-rule bg-card transition hover:border-teal focus-visible:outline-2 focus-visible:outline-teal"
    >
      <div className="relative border-r-2 border-dashed border-rule p-4 before:absolute before:-top-2 before:-right-2 before:size-4 before:rounded-full before:border before:border-rule before:bg-background after:absolute after:-right-2 after:-bottom-2 after:size-4 after:rounded-full after:border after:border-rule after:bg-background">
        <div className="font-mono text-3xl font-semibold leading-none tracking-wider">
          {placeCode(itinerary.destination)}
        </div>
        <div className="mt-2 font-extrabold">{itinerary.destination}</div>
        <div className="font-mono text-xs text-dim">
          {formatDate(itinerary.startDate)} – {formatDate(itinerary.endDate)} · {days}{' '}
          {days === 1 ? 'TAG' : 'TAGE'}
        </div>
      </div>
      <div className="flex min-w-24 flex-col justify-center p-4 text-right">
        <span className="font-mono text-[10px] uppercase tracking-widest text-dim">Budget</span>
        <span className="font-mono font-semibold tabular-nums">
          {formatMoney(itinerary.budgetCents, itinerary.currency)}
        </span>
      </div>
    </Link>
  );
}

function BoardingPassSkeleton() {
  return (
    <div
      className="grid grid-cols-[1fr_auto] rounded-xl border border-rule bg-card motion-safe:animate-pulse"
      aria-hidden="true"
    >
      <div className="flex flex-col gap-2 border-r-2 border-dashed border-rule p-4">
        <div className="h-7 w-16 rounded bg-rule" />
        <div className="h-4 w-28 rounded bg-rule" />
        <div className="h-3 w-44 rounded bg-rule" />
      </div>
      <div className="flex min-w-24 flex-col items-end justify-center gap-2 p-4">
        <div className="h-2.5 w-12 rounded bg-rule" />
        <div className="h-4 w-16 rounded bg-rule" />
      </div>
    </div>
  );
} 

export default function TripsPage() {
  const [itineraries, setItineraries] = useState<Itinerary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    authFetch(`${API_URL}/itineraries`, { cache: 'no-store' })
      .then((res) => res.json())
      .then(setItineraries)
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="mx-auto w-full max-w-2xl p-4">
      <h1 className="text-2xl font-extrabold">Meine Reisen</h1>
      <p className="mb-5 font-mono text-[11px] uppercase tracking-widest text-dim">
        Nur für dich sichtbar · an diesen Browser gebunden
      </p>
      {isLoading ? (
        <div className="flex flex-col gap-3" role="status" aria-label="Reisen werden geladen">
          {[0, 1, 2].map((i) => (
            <BoardingPassSkeleton key={i} />
          ))}
        </div>
      ) : itineraries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-rule p-6 text-center">
          <p className="font-semibold">Noch keine Reise gespeichert</p>
          <p className="mt-1 text-sm text-dim">Plane im Chat deine erste Reise.</p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-lg bg-stamp px-4 py-2 text-sm font-semibold text-white"
          >
            Reise planen
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {itineraries.map((itinerary) => (
            <li key={itinerary.id}>
              <BoardingPass itinerary={itinerary} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

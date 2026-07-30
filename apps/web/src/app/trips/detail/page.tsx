'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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

function TripDetail() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get('id');

  const [itinerary, setItinerary] = useState<ItineraryDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadItinerary = useCallback(async () => {
    if (!id) return;
    const res = await fetch(`${API_URL}/itineraries/${id}`, { cache: 'no-store' });
    setItinerary(await res.json());
    setIsLoading(false);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    fetch(`${API_URL}/itineraries/${id}`, { cache: 'no-store' })
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
    return <p className="mx-auto max-w-2xl p-4 text-sm text-zinc-500">Lädt...</p>;
  }

  const days = Array.from(new Set(itinerary.stops.map((s) => s.dayNumber))).sort(
    (a, b) => a - b,
  );

  return (
    <div className="mx-auto max-w-2xl p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{itinerary.destination}</h1>
        <DeleteTripButton
          itineraryId={itinerary.id}
          onDeleted={() => router.push('/trips')}
        />
      </div>
      <p className="mb-6 text-sm text-zinc-500">
        {new Date(itinerary.startDate).toLocaleDateString('de-DE')} –{' '}
        {new Date(itinerary.endDate).toLocaleDateString('de-DE')} · Budget:{' '}
        {(itinerary.budgetCents / 100).toFixed(2)} {itinerary.currency}
      </p>

      {days.map((day) => (
        <div key={day} className="mb-6">
          <h2 className="mb-2 text-lg font-medium">Tag {day}</h2>
          <ul className="space-y-2">
            {itinerary.stops
              .filter((stop) => stop.dayNumber === day)
              .map((stop) => (
                <li key={stop.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{stop.title}</span>
                    <span className="text-xs uppercase text-zinc-500">{stop.category}</span>
                  </div>
                  {stop.description && (
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      {stop.description}
                    </p>
                  )}
                  {stop.costCents != null && (
                    <p className="text-sm text-zinc-500">
                      {(stop.costCents / 100).toFixed(2)} {itinerary.currency}
                    </p>
                  )}
                  <div className="mt-1 text-right">
                    <DeleteStopButton
                      itineraryId={itinerary.id}
                      stopId={stop.id}
                      onDeleted={loadItinerary}
                    />
                  </div>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default function TripDetailPage() {
  return (
    <Suspense fallback={<p className="mx-auto max-w-2xl p-4 text-sm text-zinc-500">Lädt...</p>}>
      <TripDetail />
    </Suspense>
  );
}

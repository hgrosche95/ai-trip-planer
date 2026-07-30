'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Itinerary {
  id: string;
  destination: string;
  startDate: string;
  endDate: string;
  budgetCents: number;
  currency: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export default function TripsPage() {
  const [itineraries, setItineraries] = useState<Itinerary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/itineraries`, { cache: 'no-store' })
      .then((res) => res.json())
      .then(setItineraries)
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-2xl p-4">
      <h1 className="mb-4 text-2xl font-semibold">Deine gespeicherten Reisen</h1>
      {isLoading ? (
        <p className="text-sm text-zinc-500">Lädt...</p>
      ) : (
        <ul className="space-y-3">
          {itineraries.map((itinerary) => (
            <li key={itinerary.id}>
              <Link
                href={`/trips/detail?id=${itinerary.id}`}
                className="block rounded-lg border p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <div className="font-medium">{itinerary.destination}</div>
                <div className="text-sm text-zinc-500">
                  {new Date(itinerary.startDate).toLocaleDateString('de-DE')} –{' '}
                  {new Date(itinerary.endDate).toLocaleDateString('de-DE')} · Budget:{' '}
                  {(itinerary.budgetCents / 100).toFixed(2)} {itinerary.currency}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

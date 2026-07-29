import Link from 'next/link';

interface Itinerary {
  id: string;
  destination: string;
  startDate: string;
  endDate: string;
  budgetCents: number;
  currency: string;
}

async function getItineraries(): Promise<Itinerary[]> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/itineraries`, {
    cache: 'no-store',
  });
  return res.json();
}

export default async function TripsPage() {
  const itineraries = await getItineraries();

  return (
    <div className="mx-auto max-w-2xl p-4">
      <h1 className="mb-4 text-2xl font-semibold">Deine gespeicherten Reisen</h1>
      <ul className="space-y-3">
        {itineraries.map((itinerary) => (
          <li key={itinerary.id}>
            <Link
              href={`/trips/${itinerary.id}`}
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
    </div>
  );
}
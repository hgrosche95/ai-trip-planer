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

async function getItinerary(id: string): Promise<ItineraryDetail> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/itineraries/${id}`, {
    cache: 'no-store',
  });
  return res.json();
}

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const itinerary = await getItinerary(id);

  const days = Array.from(new Set(itinerary.stops.map((s) => s.dayNumber))).sort(
    (a, b) => a - b,
  );

  return (
    <div className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-semibold">{itinerary.destination}</h1>
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
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
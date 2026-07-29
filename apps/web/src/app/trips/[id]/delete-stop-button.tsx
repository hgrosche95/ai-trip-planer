'use client';

import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export default function DeleteStopButton({
  itineraryId,
  stopId,
}: {
  itineraryId: string;
  stopId: string;
}) {
  const router = useRouter();

  async function handleDelete() {
    await fetch(`${API_URL}/itineraries/${itineraryId}/stops/${stopId}`, {
      method: 'DELETE',
    });
    router.refresh();
  }

  return (
    <button onClick={handleDelete} className="text-xs text-red-600 hover:underline">
      Entfernen
    </button>
  );
}

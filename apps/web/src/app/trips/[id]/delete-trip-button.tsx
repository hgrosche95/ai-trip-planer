'use client';

import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export default function DeleteTripButton({ itineraryId }: { itineraryId: string }) {
  const router = useRouter();

  async function handleDelete() {
    await fetch(`${API_URL}/itineraries/${itineraryId}`, { method: 'DELETE' });
    router.push('/trips');
  }

  return (
    <button
      onClick={handleDelete}
      className="rounded-lg border border-red-300 px-3 py-1 text-sm text-red-600 hover:bg-red-50"
    >
      Reise löschen
    </button>
  );
}

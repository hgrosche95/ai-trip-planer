'use client';

import { authFetch } from '@/lib/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export default function DeleteTripButton({
  itineraryId,
  onDeleted,
}: {
  itineraryId: string;
  onDeleted: () => void;
}) {
  async function handleDelete() {
    await authFetch(`${API_URL}/itineraries/${itineraryId}`, { method: 'DELETE' });
    onDeleted();
  }

  return (
    <button
      onClick={handleDelete}
      className="rounded-lg border border-stamp/40 px-3 py-1 text-sm font-semibold text-stamp hover:bg-stamp/10 dark:text-red-400"
    >
      Reise löschen
    </button>
  );
}

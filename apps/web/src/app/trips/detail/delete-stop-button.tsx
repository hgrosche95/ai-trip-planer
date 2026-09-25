'use client';

import { authFetch } from '@/lib/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export default function DeleteStopButton({
  itineraryId,
  stopId,
  onDeleted,
}: {
  itineraryId: string;
  stopId: string;
  onDeleted: () => void;
}) {
  async function handleDelete() {
    await authFetch(`${API_URL}/itineraries/${itineraryId}/stops/${stopId}`, {
      method: 'DELETE',
    });
    onDeleted();
  }

  return (
    <button
      onClick={handleDelete}
      className="font-mono text-[10px] uppercase tracking-widest text-dim hover:text-stamp"
    >
      Entfernen
    </button>
  );
}

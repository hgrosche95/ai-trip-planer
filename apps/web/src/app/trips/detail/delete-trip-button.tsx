'use client';

import ConfirmButton from '@/components/confirm-button';
import { authFetch } from '@/lib/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

// Löschen lässt sich nicht rückgängig machen, deshalb fragt der Knopf nach
export default function DeleteTripButton({
  itineraryId,
  destination,
  onDeleted,
}: {
  itineraryId: string;
  destination: string;
  onDeleted: () => void;
}) {
  async function handleDelete() {
    const response = await authFetch(`${API_URL}/itineraries/${itineraryId}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    onDeleted();
  }

  return (
    <ConfirmButton
      label="Reise löschen"
      accessibleLabel={`Reise nach ${destination} löschen`}
      question="Endgültig löschen?"
      confirmLabel="Ja, löschen"
      pendingLabel="Wird gelöscht …"
      onConfirm={handleDelete}
      className="min-h-9 shrink-0 whitespace-nowrap rounded-lg border border-stamp/40 px-3 text-sm font-semibold text-stamp hover:bg-stamp/10 dark:text-red-400"
    />
  );
}

'use client';

import ConfirmButton from '@/components/confirm-button';
import { authFetch } from '@/lib/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export default function DeleteStopButton({
  itineraryId,
  stopId,
  stopTitle,
  onDeleted,
}: {
  itineraryId: string;
  stopId: string;
  stopTitle: string;
  onDeleted: () => void;
}) {
  async function handleDelete() {
    const response = await authFetch(`${API_URL}/itineraries/${itineraryId}/stops/${stopId}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    onDeleted();
  }

  return (
    <ConfirmButton
      label="Entfernen"
      accessibleLabel={`${stopTitle} entfernen`}
      question="Wirklich entfernen?"
      confirmLabel="Ja, entfernen"
      pendingLabel="Wird entfernt …"
      onConfirm={handleDelete}
      className="-my-1 -mr-2 min-h-9 rounded-lg px-2 text-xs font-semibold text-dim hover:bg-stamp/10 hover:text-stamp"
    />
  );
}

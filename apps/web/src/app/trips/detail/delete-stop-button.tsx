'use client';

import { useState } from 'react';
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
  const [failed, setFailed] = useState(false);

  async function handleDelete() {
    setFailed(false);
    try {
      const response = await authFetch(`${API_URL}/itineraries/${itineraryId}/stops/${stopId}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch {
      setFailed(true);
      return;
    }
    onDeleted();
  }

  return (
    <button
      onClick={handleDelete}
      className="font-mono text-[10px] uppercase tracking-widest text-dim hover:text-stamp"
    >
      {failed ? 'Fehlgeschlagen, nochmal?' : 'Entfernen'}
    </button>
  );
}

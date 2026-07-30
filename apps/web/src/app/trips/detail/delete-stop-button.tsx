'use client';

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
    await fetch(`${API_URL}/itineraries/${itineraryId}/stops/${stopId}`, {
      method: 'DELETE',
    });
    onDeleted();
  }

  return (
    <button onClick={handleDelete} className="text-xs text-red-600 hover:underline">
      Entfernen
    </button>
  );
}

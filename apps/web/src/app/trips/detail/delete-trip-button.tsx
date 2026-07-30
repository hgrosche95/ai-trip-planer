'use client';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export default function DeleteTripButton({
  itineraryId,
  onDeleted,
}: {
  itineraryId: string;
  onDeleted: () => void;
}) {
  async function handleDelete() {
    await fetch(`${API_URL}/itineraries/${itineraryId}`, { method: 'DELETE' });
    onDeleted();
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

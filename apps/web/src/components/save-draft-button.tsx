'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { authFetch } from '@/lib/auth';
import type { ItineraryDraft } from '@/lib/run-events';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; id: string }
  | { kind: 'error'; message: string };

// "Plan speichern" unter einer Antwort des Multi-Agenten-Modus: Der Planer
// liefert nur einen Entwurf, gespeichert wird er erst hier, mit genau dem
// Body von POST /itineraries. Nur der neueste Entwurf des Chats bietet den
// Button an; ältere (superseded) zeigen "Überholt durch neuere Version",
// wurden sie schon gespeichert, bleibt der Link zur gespeicherten Reise.
// revision: Fassung in der Session, ab 2 steht sie im Hinweis.
export default function SaveDraftButton({
  itinerary,
  revision = 1,
  superseded = false,
}: {
  itinerary: ItineraryDraft;
  revision?: number;
  superseded?: boolean;
}) {
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  // Sperre gegen Doppelklick: greift sofort, nicht erst nach dem nächsten Rendern
  const busy = useRef(false);

  async function save() {
    if (busy.current || superseded || state.kind === 'saved') return;
    busy.current = true;
    setState({ kind: 'saving' });
    try {
      const response = await authFetch(`${API_URL}/itineraries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(itinerary),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { id } = (await response.json()) as { id: string };
      setState({ kind: 'saved', id });
    } catch {
      setState({
        kind: 'error',
        message: 'Speichern hat nicht geklappt. Versuch es bitte noch einmal.',
      });
      busy.current = false;
    }
  }

  const saved = state.kind === 'saved';
  const savedLink = saved && (
    <p role="status" className="text-sm">
      <span className="font-semibold text-teal dark:text-teal-300">Gespeichert</span>
      {' · '}
      <Link
        href={`/trips/detail?id=${encodeURIComponent(state.id)}`}
        className="underline decoration-dotted underline-offset-2 hover:text-teal"
      >
        In Meine Reisen ansehen
      </Link>
    </p>
  );

  if (superseded) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-xs text-dim">Überholt durch neuere Version</p>
        {savedLink}
      </div>
    );
  }

  const version = revision > 1 ? `Fassung ${revision}, ` : '';
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        onClick={save}
        disabled={state.kind === 'saving' || saved}
        className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-teal dark:bg-foreground dark:text-background"
      >
        {state.kind === 'saving' ? 'Wird gespeichert …' : 'Plan speichern'}
      </button>
      {saved ? (
        savedLink
      ) : state.kind === 'error' ? (
        <p role="alert" className="text-xs text-stamp">
          {state.message}
        </p>
      ) : (
        <p className="text-xs text-dim">Entwurf, {version}noch nicht gespeichert</p>
      )}
    </div>
  );
}

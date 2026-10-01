'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import ConfirmButton from '@/components/confirm-button';
import { authFetch } from '@/lib/auth';
import { readChatSession, writeChatSession } from '@/lib/chat-session';
import { editSession, type SeededDraft } from '@/lib/edit-trip';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

const buttonClass =
  'min-h-9 shrink-0 whitespace-nowrap rounded-lg bg-navy px-3 text-sm font-semibold text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-(--focus) dark:bg-foreground dark:text-background';

// "Im Chat bearbeiten": Die API macht die Reise zum Entwurf einer neuen
// Chat-Session (kostet keine Tokens), der Chat öffnet sie auf der
// Arbeitsfläche. Folgenachrichten ändern Tage und Programmpunkte,
// "Änderungen speichern" ersetzt dann diese Reise. Läuft im Tab schon ein
// Chat, fragt der Knopf vorher nach, denn der wird ersetzt.
export default function EditTripButton({ itineraryId }: { itineraryId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  // Erst beim Rendern im Browser gelesen: Beim Vorrendern gibt es keinen Chat
  const hasChat = typeof window !== 'undefined' && (readChatSession()?.messages.length ?? 0) > 0;

  // Wirft bei einem Fehler: Die Nachfrage zeigt dann "Hat nicht geklappt"
  async function openInChat() {
    const sessionId = crypto.randomUUID();
    const response = await authFetch(`${API_URL}/agent/drafts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, itineraryId }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const seed = (await response.json()) as SeededDraft;
    writeChatSession(editSession(sessionId, seed));
    router.push('/');
  }

  async function openDirectly() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await openInChat();
    } catch {
      setError('Die Reise ließ sich gerade nicht öffnen. Versuch es bitte noch einmal.');
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {hasChat ? (
        <ConfirmButton
          label="Im Chat bearbeiten"
          question="Laufenden Chat ersetzen?"
          confirmLabel="Ja, bearbeiten"
          pendingLabel="Wird geöffnet …"
          tone="neutral"
          onConfirm={openInChat}
          className={buttonClass}
        />
      ) : (
        <button type="button" onClick={openDirectly} disabled={pending} className={buttonClass}>
          {pending ? 'Wird geöffnet …' : 'Im Chat bearbeiten'}
        </button>
      )}
      {error && (
        <p role="alert" className="text-xs text-stamp">
          {error}
        </p>
      )}
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';

type State = 'idle' | 'confirming' | 'pending' | 'failed';

// Zerstörerische Aktion in zwei Schritten, ohne Dialog: Der erste Klick fragt
// an Ort und Stelle nach, erst "Ja" führt aus. Abbrechen (auch mit Escape)
// bringt den Ausgangsknopf zurück. onConfirm darf asynchron sein und werfen:
// Dann bleibt die Nachfrage mit einem Hinweis stehen und man kann es erneut
// versuchen.
export default function ConfirmButton({
  label,
  accessibleLabel,
  question,
  confirmLabel,
  pendingLabel = 'Einen Moment …',
  onConfirm,
  className,
  tone = 'danger',
}: {
  label: string;
  // Name für Screenreader, wenn label allein nicht sagt, was betroffen ist
  accessibleLabel?: string;
  question: string;
  confirmLabel: string;
  pendingLabel?: string;
  onConfirm: () => void | Promise<void>;
  className: string;
  tone?: 'danger' | 'neutral';
}) {
  const [state, setState] = useState<State>('idle');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  // Fokus folgt der Nachfrage: auf "Abbrechen", danach zurück zum Auslöser
  useEffect(() => {
    if (state === 'confirming') cancelRef.current?.focus();
    if (state === 'idle' && returnFocus.current) {
      returnFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [state]);

  function cancel() {
    returnFocus.current = true;
    setState('idle');
  }

  async function confirm() {
    setState('pending');
    try {
      await onConfirm();
      // Die Komponente verschwindet meist mit dem Gelöschten; bleibt sie
      // (z. B. "Neue Reise"), steht wieder der Ausgangsknopf da
      setState('idle');
    } catch {
      setState('failed');
    }
  }

  if (state === 'idle') {
    return (
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setState('confirming')}
        aria-label={accessibleLabel}
        className={className}
      >
        {label}
      </button>
    );
  }

  const confirmClass =
    tone === 'danger'
      ? 'bg-stamp text-white hover:bg-stamp/90'
      : 'bg-navy text-white dark:bg-foreground dark:text-background';
  return (
    <div
      role="group"
      aria-label={accessibleLabel ?? label}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && state !== 'pending') cancel();
      }}
      className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-sm"
    >
      <span role={state === 'failed' ? 'alert' : undefined} className={state === 'failed' ? 'text-stamp' : ''}>
        {state === 'failed' ? 'Hat nicht geklappt. Nochmal?' : question}
      </span>
      <button
        type="button"
        onClick={confirm}
        disabled={state === 'pending'}
        className={`min-h-9 rounded-lg px-3 font-semibold disabled:opacity-60 ${confirmClass}`}
      >
        {state === 'pending' ? pendingLabel : confirmLabel}
      </button>
      <button
        ref={cancelRef}
        type="button"
        onClick={cancel}
        disabled={state === 'pending'}
        className="min-h-9 rounded-lg border border-rule px-3 font-semibold disabled:opacity-60"
      >
        Abbrechen
      </button>
    </div>
  );
}

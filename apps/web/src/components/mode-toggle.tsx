'use client';

import { useRef } from 'react';
import { AGENT_MODE_OPTIONS } from '@/lib/agent-mode';
import type { AgentMode } from '@/lib/run-events';

// Segment-Control über dem Eingabefeld: ein Agent oder Planer, Recherche und
// Budget. Als Radiogruppe zugänglich: Tab springt auf die gewählte Option,
// Pfeiltasten wechseln (und wählen) wie bei nativen Radiobuttons.
export default function ModeToggle({
  mode,
  onChange,
}: {
  mode: AgentMode;
  onChange: (mode: AgentMode) => void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function handleKeyDown(event: React.KeyboardEvent, index: number) {
    const last = AGENT_MODE_OPTIONS.length - 1;
    let next: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = index === last ? 0 : index + 1;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = index === 0 ? last : index - 1;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = last;
    }
    if (next === undefined) return;
    event.preventDefault();
    onChange(AGENT_MODE_OPTIONS[next].mode);
    buttons.current[next]?.focus();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span id="agent-mode-label" className="font-mono text-[11px] uppercase tracking-widest text-dim">
        Modus
      </span>
      <div
        role="radiogroup"
        aria-labelledby="agent-mode-label"
        className="inline-flex rounded-lg border border-rule bg-card p-0.5"
      >
        {AGENT_MODE_OPTIONS.map((option, index) => {
          const selected = option.mode === mode;
          return (
            <button
              key={option.mode}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(option.mode)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={
                'min-h-9 rounded-md px-2.5 py-1 text-left text-xs transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--focus) ' +
                (selected
                  ? 'bg-teal/10 text-teal dark:bg-teal-300/10 dark:text-teal-300'
                  : 'text-dim hover:text-foreground')
              }
            >
              <span className="font-mono text-[11px] font-semibold uppercase tracking-widest">
                {option.label}
              </span>
              <span className="hidden sm:inline"> · {option.detail}</span>
              <span className="sr-only sm:hidden"> · {option.detail}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

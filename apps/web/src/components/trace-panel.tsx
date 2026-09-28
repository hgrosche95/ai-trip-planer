'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import Spinner from '@/components/spinner';
import type { RunState, TraceStep } from '@/lib/run-state';

// Anzeigenamen der Tools. Unbekannte Tools erscheinen mit ihrem technischen Namen.
const TOOL_LABELS: Record<string, string> = {
  search_travel_knowledge: 'Wissensbasis durchsuchen',
  show_destination_on_globe: 'Ziel auf dem Globus zeigen',
  get_weather: 'Wetter abrufen',
  search_lodging: 'Unterkünfte suchen',
  estimate_transport: 'Anreise schätzen',
  convert_currency: 'Währung umrechnen',
  save_itinerary: 'Reiseplan speichern',
};

const KIND_ICONS: Record<TraceStep['kind'], string> = {
  llm: '◆',
  tool: '⚙',
  retriever: '⌕',
};

const numberFormat = new Intl.NumberFormat('de-DE');

function formatMs(ms: number) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

// Die Beträge pro Aufruf liegen meist weit unter einem Cent, deshalb in
// US-Cent mit drei Nachkommastellen statt "0,00 $".
function formatCost(usd: number) {
  return `${(usd * 100).toFixed(3).replace('.', ',')} ¢`;
}

function stepLabel(step: TraceStep) {
  if (step.kind === 'llm') {
    // "openai/gpt-oss-120b" → "gpt-oss-120b"
    return step.status === 'running' ? step.name : `LLM · ${step.name.split('/').pop()}`;
  }
  return TOOL_LABELS[step.name] ?? step.name;
}

function stepDetails(step: TraceStep) {
  const parts: string[] = [];
  if (step.inputTokens !== undefined && step.outputTokens !== undefined) {
    parts.push(`${numberFormat.format(step.inputTokens + step.outputTokens)} Tokens`);
  }
  if (step.hits !== undefined) {
    parts.push(`${step.hits} Treffer`);
  }
  // Zeigt, warum ein Aufruf externer APIs nur wenige Millisekunden dauerte
  if (step.cached) parts.push('Cache');
  if (step.costUsd) parts.push(formatCost(step.costUsd));
  if (step.latencyMs !== undefined) parts.push(formatMs(step.latencyMs));
  return parts.join(' · ');
}

function StepRow({ step }: { step: TraceStep }) {
  const tone =
    step.status === 'error'
      ? 'text-stamp'
      : step.kind === 'llm'
        ? 'text-navy dark:text-foreground'
        : 'text-teal dark:text-teal-300';
  return (
    <li className="flex items-center gap-2 py-1">
      <span aria-hidden="true" className={`w-4 text-center ${tone}`}>
        {step.status === 'running' ? <Spinner className="h-3 w-3" /> : KIND_ICONS[step.kind]}
      </span>
      <span className={`flex-1 truncate ${step.status === 'error' ? 'text-stamp' : ''}`}>
        {stepLabel(step)}
        {step.status === 'error' && ' · Fehler'}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-dim">{stepDetails(step)}</span>
    </li>
  );
}

function TotalsLine({ run }: { run: RunState }) {
  const totals = run.totals;
  if (!totals) return null;
  const parts = [
    `${totals.llmCalls} LLM-Aufrufe`,
    `${totals.toolCalls} Tools`,
    `${numberFormat.format(totals.inputTokens + totals.outputTokens)} Tokens`,
    formatMs(totals.durationMs),
  ];
  if (totals.costUsd > 0) parts.push(`≈ ${formatCost(totals.costUsd)}`);
  return <>{parts.join(' · ')}</>;
}

// API und RAG-Service skalieren in Azure auf null herunter. Nach einer Pause
// startet der erste Aufruf deshalb erst einen Container, und bis zum ersten
// Agentenschritt vergehen Sekunden ohne sichtbaren Fortschritt. Dauert es
// länger als üblich, sagt der Chat, warum.
const COLD_START_HINT_MS = 5_000;

function StartingHint() {
  const [isSlow, setIsSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setIsSlow(true), COLD_START_HINT_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <>
      <p className="flex items-center gap-2 py-1 text-dim">
        <Spinner className="h-3 w-3" /> Startet…
      </p>
      {isSlow && (
        <p className="pb-1 text-xs text-dim">
          Der Server war im Ruhezustand und fährt gerade hoch. Die erste Anfrage nach
          einer Pause kann bis zu einer halben Minute dauern, danach geht es schneller.
        </p>
      )}
    </>
  );
}

// Zeigt, was der Agent gerade tut bzw. getan hat: jede Zeile ein LLM-Aufruf
// oder Tool, mit Tokens, Kosten und Dauer. Während des Laufs offen, danach
// als eingeklappter Abschnitt unter der Antwort, dort mit Link zum erneuten
// Abspielen (/replay), sobald der Lauf gespeichert ist.
export default function TracePanel({
  run,
  live = false,
  replayLink = true,
}: {
  run: RunState;
  live?: boolean;
  replayLink?: boolean;
}) {
  if (live) {
    return (
      <div className="rounded-xl border border-rule bg-card px-3 py-2 text-sm" aria-live="polite">
        <p className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-teal dark:text-teal-300">
          Agent arbeitet
        </p>
        {run.steps.length === 0 ? (
          <StartingHint />
        ) : (
          <ol>
            {run.steps.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </ol>
        )}
      </div>
    );
  }

  if (run.steps.length === 0) return null;
  return (
    <details className="mt-3 border-t border-rule pt-2 text-sm">
      <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-widest text-dim">
        Ablauf · <TotalsLine run={run} />
      </summary>
      <ol className="mt-1">
        {run.steps.map((step) => (
          <StepRow key={step.id} step={step} />
        ))}
      </ol>
      {replayLink && run.runId && (
        <Link
          href={`/replay?run=${encodeURIComponent(run.runId)}`}
          className="mt-1 inline-block font-mono text-[10px] uppercase tracking-widest text-teal hover:underline dark:text-teal-300"
        >
          ▶ Lauf erneut abspielen
        </Link>
      )}
    </details>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import Spinner from '@/components/spinner';
import { AGENT_MODE_LABELS } from '@/lib/agent-mode';
import {
  TASK_LABELS,
  TASK_STATUS_ICONS,
  agentLanes,
  type LaneBar,
} from '@/lib/agent-lanes';
import type { AgentName, PlanTask } from '@/lib/run-events';
import type { RunState, TraceStep } from '@/lib/run-state';

// Anzeigenamen der Tools. Unbekannte Tools erscheinen mit ihrem technischen Namen.
const TOOL_LABELS: Record<string, string> = {
  search_travel_knowledge: 'Wissensbasis durchsuchen',
  show_destination_on_globe: 'Ziel auf dem Globus zeigen',
  get_weather: 'Wetter abrufen',
  search_lodging: 'Unterkünfte suchen',
  estimate_transport: 'Anreise schätzen',
  convert_currency: 'Währung umrechnen',
  get_public_holidays: 'Feiertage abfragen',
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

// Ganze Sekunden reichen für eine Wartezeit, "6,2 s" wäre Scheingenauigkeit
function formatWait(ms: number) {
  return ms < 1000 ? `${ms} ms` : `${Math.round(ms / 1000)} s`;
}

function stepDetails(step: TraceStep) {
  const parts: string[] = [];
  // Vorab eingeplante Pause statt HTTP 429: erklärt, warum ein Schritt dauert
  if (step.throttledMs) parts.push(`wartet ${formatWait(step.throttledMs)} auf Groq-Limit`);
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

// Eine Farbe pro Agent, damit die Lanes auf einen Blick unterscheidbar sind
const AGENT_BAR_COLORS: Record<AgentName, string> = {
  orchestrator: 'bg-dim',
  planner: 'bg-navy dark:bg-foreground/80',
  research: 'bg-teal dark:bg-teal-300',
  budget: 'bg-amber-500',
  critic: 'bg-violet-500',
};

// Live steht die Dauer rechts in der Zeile, im Ablauf hier in den Details
function barDetails(bar: LaneBar, withDuration = true) {
  const parts: string[] = [];
  if (bar.step.summary) parts.push(bar.step.summary);
  if (bar.tokens > 0) parts.push(`${numberFormat.format(bar.tokens)} Tokens`);
  if (withDuration && bar.step.durationMs !== undefined) parts.push(formatMs(bar.step.durationMs));
  return parts.join(' · ');
}

// Multi-Agenten-Modus: eine Lane pro Agent, eine Zeile pro Aufgabe.
// Live zeigt jede Zeile nur, was wir wirklich wissen: läuft (mit hochzählender
// Zeit) oder fertig (mit ihrer Dauer). Einen Fortschrittsbalken gibt es live
// bewusst nicht: Wie weit ein KI-Aufruf ist, kennt niemand, und ein relativ
// zur wachsenden Laufzeit skalierter Balken würde auch fertige Aufgaben
// weiter schrumpfen lassen. Nach dem Lauf, wenn sich nichts mehr ändert,
// zeigt der Ablauf den Wasserfall: gleichzeitige Recherchen überlappen.
function AgentLanes({
  run,
  nowMs,
  live = false,
}: {
  run: RunState;
  nowMs?: number;
  live?: boolean;
}) {
  const { lanes } = agentLanes(run, nowMs);
  const now = Math.max(run.lastMs, nowMs ?? 0);
  if (lanes.length === 0) return null;
  return (
    <div className="space-y-2 py-1" aria-label="Agenten">
      {lanes.map((lane) => (
        <section key={lane.agent} aria-label={lane.label}>
          <p className="font-mono text-[11px] uppercase tracking-widest text-dim">{lane.label}</p>
          <ol className="space-y-0.5">
            {lane.bars.map((bar) => (
              <li key={bar.step.id} className="text-xs">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="w-4 text-center">
                    {bar.step.status === 'running' ? (
                      <Spinner className="h-3 w-3" />
                    ) : bar.step.status === 'error' ? (
                      <span className="text-stamp">✗</span>
                    ) : (
                      <span className="text-dim">✓</span>
                    )}
                  </span>
                  <span className={`w-36 shrink-0 truncate ${bar.step.status === 'error' ? 'text-stamp' : ''}`}>
                    {TASK_LABELS[bar.step.task] ?? bar.step.task}
                  </span>
                  {live ? (
                    <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-dim">
                      {bar.step.status === 'running'
                        ? `läuft · ${formatMs(Math.max(0, Math.round(now - bar.step.startedMs)))}`
                        : bar.step.durationMs !== undefined
                          ? formatMs(bar.step.durationMs)
                          : ''}
                    </span>
                  ) : (
                    <span className="relative h-2 flex-1 rounded-full bg-rule/40">
                      <span
                        className={`absolute top-0 h-2 rounded-full ${bar.step.status === 'error' ? 'bg-stamp' : AGENT_BAR_COLORS[lane.agent]}`}
                        style={{ left: `${bar.leftPct}%`, width: `${bar.widthPct}%` }}
                      />
                    </span>
                  )}
                </div>
                <p className="truncate pl-6 font-mono text-[11px] text-dim">
                  {barDetails(bar, !live)}
                </p>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

// Die Aufgaben aus dem Plan des Planers mit ihrem Stand
function TaskChecklist({ tasks }: { tasks: PlanTask[] }) {
  if (tasks.length === 0) return null;
  return (
    <ul aria-label="Aufgaben" className="flex flex-wrap gap-x-3 gap-y-0.5 py-1 font-mono text-[11px]">
      {tasks.map((task) => (
        <li
          key={task.id}
          className={
            task.status === 'done'
              ? 'text-teal dark:text-teal-300'
              : task.status === 'error'
                ? 'text-stamp'
                : 'text-dim'
          }
        >
          <span aria-hidden="true">{TASK_STATUS_ICONS[task.status]} </span>
          {TASK_LABELS[task.type] ?? task.type}
          <span className="sr-only"> ({task.status})</span>
        </li>
      ))}
    </ul>
  );
}

// Zeittakt der Live-Anzeige: oft genug, dass die Laufzeit laufender Aufgaben
// sichtbar hochzählt, selten genug, um nicht jeden Frame neu zu rendern.
const CLOCK_TICK_MS = 150;

// Zwischen zwei Ereignissen schickt der Server nichts, ein KI-Aufruf dauert
// aber Sekunden. Damit die Laufzeit laufender Aufgaben trotzdem hochzählt,
// rechnet diese Uhr ab dem Moment, in dem das letzte Ereignis im Browser
// ankam, selbst weiter.
function useRunClock(run: RunState, active: boolean): number {
  const anchor = useRef({ lastMs: run.lastMs, receivedAt: 0 });
  const [nowMs, setNowMs] = useState(run.lastMs);

  useEffect(() => {
    anchor.current = { lastMs: run.lastMs, receivedAt: performance.now() };
  }, [run.lastMs]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      const { lastMs, receivedAt } = anchor.current;
      setNowMs(lastMs + (performance.now() - receivedAt));
    }, CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [active]);

  return Math.max(run.lastMs, nowMs);
}

// Classic: eine Zeile pro LLM-Aufruf oder Tool. Multi: Aufgaben und Lanes.
function StepsView({
  run,
  nowMs,
  live = false,
}: {
  run: RunState;
  nowMs?: number;
  live?: boolean;
}) {
  if (run.agentSteps.length > 0) {
    return (
      <>
        <TaskChecklist tasks={run.tasks} />
        <AgentLanes run={run} nowMs={nowMs} live={live} />
      </>
    );
  }
  return (
    <ol>
      {run.steps.map((step) => (
        <StepRow key={step.id} step={step} />
      ))}
    </ol>
  );
}

function TotalsLine({ run }: { run: RunState }) {
  // Modus vorn, damit sich Antworten aus beiden Modi direkt vergleichen lassen.
  // Auch ohne Summen (abgebrochener Lauf) sieht man, welcher Modus lief.
  const parts = run.mode ? [AGENT_MODE_LABELS[run.mode]] : [];
  // Folgenachricht, die einen Entwurf geändert hat: Die Zahlen gehören zur
  // Überarbeitung, nicht zu einem ganzen Plan
  if (run.draft?.change !== undefined) {
    parts.push(`Überarbeitung (Fassung ${run.draft.revision})`);
  }
  const totals = run.totals;
  if (totals) {
    parts.push(
      `${totals.llmCalls} LLM-Aufrufe`,
      `${totals.toolCalls} Tools`,
      `${numberFormat.format(totals.inputTokens + totals.outputTokens)} Tokens`,
      formatMs(totals.durationMs),
    );
    if (totals.costUsd > 0) parts.push(`≈ ${formatCost(totals.costUsd)}`);
  }
  if (parts.length === 0) return null;
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
  const nowMs = useRunClock(run, live && run.status === 'running');
  if (live) {
    return (
      <div className="rounded-xl border border-rule bg-card px-3 py-2 text-sm" aria-live="polite">
        <p className="mb-1 flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-teal dark:text-teal-300">
          {run.mode === 'multi' ? 'Agenten arbeiten' : 'Agent arbeitet'}
        </p>
        {run.steps.length === 0 && run.agentSteps.length === 0 ? (
          <StartingHint />
        ) : (
          <StepsView run={run} nowMs={nowMs} live />
        )}
      </div>
    );
  }

  if (run.steps.length === 0 && run.agentSteps.length === 0) return null;
  return (
    <details className="mt-3 border-t border-rule pt-2 text-sm">
      <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-widest text-dim">
        Ablauf · <TotalsLine run={run} />
      </summary>
      <div className="mt-1">
        <StepsView run={run} />
      </div>
      {replayLink && run.runId && (
        <Link
          href={`/replay?run=${encodeURIComponent(run.runId)}`}
          className="mt-1 inline-block font-mono text-[11px] uppercase tracking-widest text-teal hover:underline dark:text-teal-300"
        >
          ▶ Lauf erneut abspielen
        </Link>
      )}
    </details>
  );
}

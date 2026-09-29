'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { authFetch } from '@/lib/auth';
import BudgetBar from '@/components/budget-bar';
import LodgingList from '@/components/lodging-list';
import ReplyMarkdown from '@/components/reply-markdown';
import TracePanel from '@/components/trace-panel';
import TripGlobe from '@/components/trip-globe';
import WeatherStrip from '@/components/weather-strip';
import { globeView, replayDurationMs, replaySchedule, REPLAY_SPEED } from '@/lib/replay';
import type { RunEvent, RunTotals } from '@/lib/run-events';
import { applyRunEvent, initialRunState, type RunState } from '@/lib/run-state';

// Antwort von GET /agent/runs/:id
interface StoredRun {
  id: string;
  createdAt: string;
  status: 'running' | 'ok' | 'error' | 'aborted';
  totals: RunTotals;
  events: RunEvent[];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL;

async function fetchRun(id: string): Promise<StoredRun> {
  const res = await authFetch(`${API_URL}/agent/runs/${encodeURIComponent(id)}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`, { cause: res.status });
  return res.json();
}

function loadErrorMessage(error: unknown) {
  // Die API unterscheidet bewusst nicht zwischen "gibt es nicht" und
  // "gehört jemand anderem". Gäste sehen ihre Läufe nur in dem Browser,
  // in dem sie gechattet haben.
  return error instanceof Error && error.cause === 404
    ? 'Diesen Lauf gibt es nicht (mehr), oder er gehört zu einem anderen Konto bzw. Browser.'
    : 'Der Lauf konnte gerade nicht geladen werden. Versuch es bitte gleich noch einmal.';
}

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

function formatSeconds(ms: number) {
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

function ReplaySkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-2xl p-4 motion-safe:animate-pulse"
      role="status"
      aria-label="Lauf wird geladen"
    >
      <div className="h-3 w-40 rounded bg-rule" />
      <div className="mt-2 h-7 w-64 rounded bg-rule" />
      <div className="mx-auto mt-4 aspect-square w-full max-w-[22rem] rounded-full bg-rule" />
      <div className="mt-4 h-24 rounded-xl border border-rule bg-card" />
    </div>
  );
}

function Replay() {
  const id = useSearchParams().get('run');
  const [stored, setStored] = useState<StoredRun | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Zustand nach den bisher abgespielten Ereignissen, derselbe Reducer wie live
  const [run, setRun] = useState<RunState>(initialRunState);
  const [played, setPlayed] = useState(0);
  // Erhöhen startet das Abspielen von vorn
  const [playKey, setPlayKey] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchRun(id).then(setStored, (error) => setLoadError(loadErrorMessage(error)));
  }, [id]);

  const schedule = useMemo(() => (stored ? replaySchedule(stored.events) : []), [stored]);

  // Ein Ereignis nach dem anderen, jeweils nach der gerafften Pause. Der
  // Zustand liegt lokal im Effekt, damit jeder Schritt auf dem vorigen
  // aufbaut, ohne auf das nächste Rendern zu warten.
  useEffect(() => {
    let state = initialRunState();
    let index = 0;
    const next = () => {
      if (index >= schedule.length) return;
      timer.current = setTimeout(() => {
        state = applyRunEvent(state, schedule[index].event);
        index++;
        setRun(state);
        setPlayed(index);
        next();
      }, schedule[index].delayMs);
    };
    next();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [schedule, playKey]);

  function showAll() {
    if (timer.current) clearTimeout(timer.current);
    setRun(schedule.reduce((state, step) => applyRunEvent(state, step.event), initialRunState()));
    setPlayed(schedule.length);
  }

  function restart() {
    if (timer.current) clearTimeout(timer.current);
    setRun(initialRunState());
    setPlayed(0);
    setPlayKey((key) => key + 1);
  }

  if (!id) {
    return <p className="mx-auto max-w-2xl p-4 text-sm text-dim">Kein Lauf ausgewählt.</p>;
  }
  if (loadError) {
    return <p className="mx-auto max-w-2xl p-4 text-sm text-dim">{loadError}</p>;
  }
  if (!stored) {
    return <ReplaySkeleton />;
  }

  const isDone = played >= schedule.length;
  const globe = globeView(run);

  return (
    <div className="mx-auto w-full max-w-2xl p-4">
      <p className="font-mono text-xs uppercase tracking-widest text-dim">Aufgezeichneter Lauf</p>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h1 className="text-2xl font-extrabold">{dateFormat.format(new Date(stored.createdAt))}</h1>
        <div className="flex gap-2 text-sm">
          {isDone ? (
            <button
              type="button"
              onClick={restart}
              className="rounded-lg border border-rule bg-card px-3 py-1.5 font-semibold hover:border-teal focus-visible:outline-2 focus-visible:outline-teal"
            >
              Noch einmal abspielen
            </button>
          ) : (
            <button
              type="button"
              onClick={showAll}
              className="rounded-lg border border-rule bg-card px-3 py-1.5 font-semibold hover:border-teal focus-visible:outline-2 focus-visible:outline-teal"
            >
              Sofort alles zeigen
            </button>
          )}
        </div>
      </div>
      <p className="mt-1 font-mono text-xs text-dim">
        Zeitraffer ×{REPLAY_SPEED} · ca. {formatSeconds(replayDurationMs(schedule))} statt{' '}
        {formatSeconds(stored.totals.durationMs)} · Ereignis {played} von {schedule.length}
      </p>
      {stored.status === 'aborted' && (
        <p className="mt-2 text-xs text-dim">
          Die Verbindung wurde während des Laufs getrennt. Der Agent hat trotzdem zu Ende
          gearbeitet, hier ist alles zu sehen.
        </p>
      )}

      <div aria-hidden="true" className="mx-auto mt-4 aspect-square w-full max-w-[22rem]">
        <TripGlobe
          focus={globe.focus}
          places={globe.places}
          arcs={globe.arcs}
          route={globe.route}
          pois={globe.pois}
        />
      </div>

      <div className="mt-4">
        {!isDone ? (
          <>
            <TracePanel run={run} live />
            {run.weather.map((report) => (
              <WeatherStrip key={report.place.name} report={report} />
            ))}
            {run.lodging.map((report) => (
              <LodgingList key={report.place.name} report={report} />
            ))}
            {run.budget && <BudgetBar report={run.budget} />}
          </>
        ) : (
          <div>
            <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-dim">
              KI-Planer
            </p>
            <div className="rounded-2xl rounded-tl-sm border border-rule bg-card px-4 py-3">
              {run.reply !== undefined ? (
                <ReplyMarkdown text={run.reply} />
              ) : (
                <p className="text-sm text-dim">
                  {run.error ?? 'Dieser Lauf endete ohne Antwort.'}
                </p>
              )}
              {run.weather.map((report) => (
                <WeatherStrip key={report.place.name} report={report} />
              ))}
              {run.lodging.map((report) => (
                <LodgingList key={report.place.name} report={report} />
              ))}
              {run.budget && <BudgetBar report={run.budget} />}
              <TracePanel run={run} replayLink={false} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// /replay?run=<id>: spielt einen gespeicherten eigenen Lauf zeitgerafft ab.
// Statische Seite (output: "export"), die Daten kommen im Browser.
export default function ReplayPage() {
  return (
    <Suspense fallback={<ReplaySkeleton />}>
      <Replay />
    </Suspense>
  );
}

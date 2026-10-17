'use client';

import { useEffect, useMemo, useState } from 'react';
import EvalChart from '@/components/eval-chart';
import {
  COMPARISON_ROWS,
  EVAL_METHOD_URL,
  METRICS,
  PROVIDERS,
  WINDOW_DAYS,
  entryPassed,
  fetchHistory,
  latestByProvider,
  windowed,
  type History,
  type HistoryEntry,
  type ProviderId,
} from '@/lib/eval-history';

// Öffentliche Qualitätsseite: Verlauf der Nachtläufe und Modellvergleich.
// Die Daten kommen nicht von der API, sondern aus dem Branch eval-data
// (raw.githubusercontent.com) - die Seite funktioniert also auch, wenn die
// API gerade auf 0 skaliert ist, und braucht kein Gast-Token.

const timeFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'long', timeStyle: 'short' });
const REPO_URL = 'https://github.com/hgrosche95/ai-trip-planer';

function StatusLine({ entry }: { entry: HistoryEntry }) {
  const passed = entryPassed(entry);
  const missed = [
    ...(entry.knowledge && !entry.knowledge.passed ? ['Wissens-Evals'] : []),
    ...(entry.scenarios?.failedThresholds ?? []),
  ];
  return (
    <div className="rounded-xl border border-rule bg-card p-4">
      <p className={`font-semibold ${passed ? 'text-teal dark:text-teal-300' : 'text-amber-700 dark:text-amber-400'}`}>
        <span aria-hidden="true">{passed ? '✓ ' : '! '}</span>
        {passed
          ? 'Letzter Lauf: alle Schwellen erfüllt'
          : `Letzter Lauf: ${missed.length} ${missed.length === 1 ? 'Schwelle' : 'Schwellen'} verfehlt`}
      </p>
      <p className="mt-1 text-sm text-dim">
        {timeFormat.format(new Date(entry.timestamp))} ·{' '}
        {PROVIDERS.find((p) => p.id === entry.provider)?.label ?? entry.provider} {entry.model}
        {entry.gitSha && (
          <>
            {' · Commit '}
            <a className="font-mono underline hover:text-foreground" href={`${REPO_URL}/commit/${entry.gitSha}`}>
              {entry.gitSha.slice(0, 7)}
            </a>
          </>
        )}
        {entry.runUrl && (
          <>
            {' · '}
            <a className="underline hover:text-foreground" href={entry.runUrl}>
              Lauf in GitHub Actions
            </a>
          </>
        )}
      </p>
      {!passed && missed.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-sm">
          {missed.map((reason) => (
            <li key={reason} className="flex gap-2">
              <span aria-hidden="true" className="text-amber-700 dark:text-amber-400">!</span>
              {reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Legende">
      {PROVIDERS.map((provider) => (
        <li key={provider.id} className="flex items-center gap-2">
          <span aria-hidden="true" className="h-0.5 w-4 rounded" style={{ background: provider.color }} />
          {provider.label}
        </li>
      ))}
      <li className="flex items-center gap-2 text-dim">
        <span aria-hidden="true" className="w-4 border-t-[1.5px] border-dashed border-dim" />
        Schwelle
      </li>
    </ul>
  );
}

function Comparison({ latest }: { latest: Map<ProviderId, HistoryEntry> }) {
  const providers = PROVIDERS.filter((p) => latest.get(p.id)?.scenarios);
  if (providers.length === 0) return null;
  return (
    <section aria-labelledby="vergleich" className="mt-10">
      <h2 id="vergleich" className="text-xl font-extrabold">Modellvergleich</h2>
      <p className="mt-1 max-w-2xl text-sm text-dim">
        Jeweils der letzte Lauf pro Anbieter mit denselben Szenarien. Der Judge ist für beide
        dasselbe Modell, sonst wären die Bewertungen nicht vergleichbar. Kosten zum Listenpreis.
        {providers.length === 1 && ' Anthropic läuft nur, wenn der Lauf von Hand gestartet wird; bisher gibt es keine Messung.'}
      </p>
      <div className="mt-4 overflow-x-auto rounded-xl border border-rule bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="p-3 font-normal text-dim">Kennzahl</th>
              {providers.map((provider) => (
                <th key={provider.id} className="p-3 text-right font-semibold">
                  <span className="flex items-center justify-end gap-2">
                    <span aria-hidden="true" className="h-0.5 w-3 rounded" style={{ background: provider.color }} />
                    {provider.label}
                  </span>
                  <span className="block break-all font-mono text-[11px] font-normal text-dim">
                    {latest.get(provider.id)!.model}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARISON_ROWS.map((row) => {
              const values = providers.map((p) => row.value(latest.get(p.id)!));
              const max = Math.max(...values.map((v) => v ?? 0));
              return (
                <tr key={row.label} className="border-t border-rule">
                  <th scope="row" className="p-3 text-left font-normal">
                    {row.label}
                    <span className="block text-xs text-dim">{row.better} ist besser</span>
                  </th>
                  {providers.map((provider, i) => {
                    const value = values[i];
                    return (
                      <td key={provider.id} className="p-3 text-right align-top">
                        <span className="font-mono font-semibold tabular-nums">
                          {value === null ? '–' : row.format(value)}
                        </span>
                        {value !== null && max > 0 && (
                          <span aria-hidden="true" className="mt-1.5 ml-auto block h-1.5 w-full max-w-32 overflow-hidden">
                            <span
                              className="ml-auto block h-full rounded-full"
                              style={{ width: `${(value / max) * 100}%`, background: provider.color }}
                            />
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Failures({ latest }: { latest: Map<ProviderId, HistoryEntry> }) {
  const withFailures = PROVIDERS.map((provider) => ({ provider, entry: latest.get(provider.id) })).filter(
    ({ entry }) => entry?.scenarios,
  );
  if (withFailures.length === 0) return null;
  return (
    <section aria-labelledby="fehlschlaege" className="mt-10">
      <h2 id="fehlschlaege" className="text-xl font-extrabold">Nicht bestandene Szenarien</h2>
      <p className="mt-1 max-w-2xl text-sm text-dim">
        Aus dem jeweils letzten Lauf. Die vollständigen Reports (mit Antworten) liegen als Artefakt am Lauf.
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {withFailures.map(({ provider, entry }) => {
          const failures = entry!.scenarios!.failures;
          return (
            <div key={provider.id} className="rounded-xl border border-rule bg-card p-4">
              <h3 className="flex items-center gap-2 font-bold">
                <span aria-hidden="true" className="h-0.5 w-3 rounded" style={{ background: provider.color }} />
                {provider.label}
                <span className="font-normal text-dim">
                  · {entry!.scenarios!.summary.passed} von {entry!.scenarios!.summary.scenarios} bestanden
                </span>
              </h3>
              {failures.length === 0 ? (
                <p className="mt-2 text-sm text-teal dark:text-teal-300">
                  <span aria-hidden="true">✓ </span>Alle Szenarien bestanden.
                </p>
              ) : (
                <ul className="mt-2 space-y-2 text-sm">
                  {failures.map((failure) => (
                    <li key={failure.id}>
                      <span className="text-stamp dark:text-red-400" aria-hidden="true">✗ </span>
                      <span className="font-semibold">{failure.title}</span>{' '}
                      <span className="font-mono text-xs text-dim">{failure.id}</span>
                      <span className="block text-dim">{failure.reasons.join('; ') || 'ohne Angabe'}</span>
                    </li>
                  ))}
                </ul>
              )}
              {entry!.runUrl && (
                <a className="mt-3 inline-block text-sm underline" href={entry!.runUrl}>
                  Zum Lauf in GitHub Actions
                </a>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Skeleton() {
  return (
    <div className="mt-6 grid gap-4 motion-safe:animate-pulse md:grid-cols-2" role="status" aria-label="Messwerte werden geladen">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-56 rounded-xl border border-rule bg-card" />
      ))}
    </div>
  );
}

export default function EvalsPage() {
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchHistory().then(setHistory, () => setError(true));
  }, []);
  const retry = () => {
    setError(false);
    fetchHistory().then(setHistory, () => setError(true));
  };

  const entries = useMemo(() => windowed(history?.entries ?? []), [history]);
  const latest = useMemo(() => latestByProvider(history?.entries ?? []), [history]);
  // Statuszeile wie das README-Badge: der letzte Lauf des Standardanbieters
  // Groq (den sieht man in der Live-Demo), sonst der jüngste überhaupt
  const newest = latest.get('groq') ?? history?.entries.at(-1);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <h1 className="text-3xl font-extrabold">Wie gut plant der Agent?</h1>
      <p className="mt-2 max-w-2xl text-dim">
        Jede Nacht laufen 12 komplette Reiseanfragen und 12 Wissensfragen gegen den echten Stack. Die
        Kennzahlen rechnet der Code aus dem fertigen Plan nach, statt der Selbstauskunft des Agenten zu
        glauben.{' '}
        <a className="underline hover:text-foreground" href={EVAL_METHOD_URL}>
          Wie gemessen wird
        </a>
      </p>

      {error && (
        <div className="mt-6 rounded-xl border border-rule bg-card p-4" role="alert">
          <p>Die Messwerte konnten gerade nicht geladen werden.</p>
          <button
            type="button"
            onClick={retry}
            className="mt-3 rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90"
          >
            Erneut versuchen
          </button>
        </div>
      )}

      {!error && !history && <Skeleton />}

      {history && !newest && (
        <p className="mt-6 rounded-xl border border-rule bg-card p-4 text-dim">
          Noch kein Nachtlauf veröffentlicht. Der erste erscheint hier nach dem nächsten Lauf um 03:00 UTC.
        </p>
      )}

      {newest && (
        <>
          <div className="mt-6">
            <StatusLine entry={newest} />
          </div>

          <section aria-labelledby="verlauf" className="mt-10">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="verlauf" className="text-xl font-extrabold">
                Verlauf <span className="font-normal text-dim">· letzte {WINDOW_DAYS} Tage</span>
              </h2>
              <Legend />
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {METRICS.map((metric) => (
                <EvalChart key={metric.id} metric={metric} entries={entries} />
              ))}
            </div>
          </section>

          <Comparison latest={latest} />
          <Failures latest={latest} />
        </>
      )}
    </main>
  );
}

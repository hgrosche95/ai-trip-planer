'use client';

import { useState, type ReactNode } from 'react';
import BudgetBar from '@/components/budget-bar';
import CritiquePanel from '@/components/critique-panel';
import LodgingList from '@/components/lodging-list';
import SaveDraftButton from '@/components/save-draft-button';
import TracePanel from '@/components/trace-panel';
import WeatherStrip, { weatherEmoji } from '@/components/weather-strip';
import { critiqueOverview } from '@/lib/critique';
import { draftDays, type DraftDay } from '@/lib/draft-days';
import { formatDate, formatMoney, placeCode, tripDays } from '@/lib/format';
import type { RunState } from '@/lib/run-state';

// Ein Entwurf auf der Arbeitsfläche: der abgeschlossene Lauf, der ihn geliefert
// hat, und die Stelle seiner Antwort im Chat
export interface CanvasDraft {
  messageIndex: number;
  run: RunState & { draft: NonNullable<RunState['draft']> };
}

type Tab = 'plan' | 'map' | 'details' | 'trace';

const TABS: { id: Tab; label: string }[] = [
  { id: 'plan', label: 'Plan' },
  { id: 'map', label: 'Karte' },
  { id: 'details', label: 'Wetter & Budget' },
  { id: 'trace', label: 'Ablauf' },
];

const CATEGORY_LABELS: Record<string, string> = {
  FOOD: 'Essen',
  CULTURE: 'Kultur',
  SIGHTSEEING: 'Sehenswert',
  ACCOMMODATION: 'Unterkunft',
  TRANSPORT: 'Transport',
  OTHER: 'Sonstiges',
};

const dayLabel = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: 'numeric',
  month: 'numeric',
  timeZone: 'UTC',
});

// Vier Tagesfarben, danach von vorn
function dayColor(dayNumber: number) {
  return `var(--day-${((dayNumber - 1) % 4) + 1})`;
}

function DayCard({ day, currency }: { day: DraftDay; currency: string }) {
  const changed = day.removed.length > 0 || day.stops.some((stop) => stop.isNew);
  const rainy = (day.weather?.precipMm ?? 0) > 1;
  return (
    <section
      aria-label={`Tag ${day.dayNumber}${changed ? ', geändert' : ''}`}
      className={
        'flex min-w-0 flex-col rounded-xl border border-t-4 border-rule bg-card ' +
        (changed ? 'ring-2 ring-teal dark:ring-teal-300' : '')
      }
      style={{ borderTopColor: dayColor(day.dayNumber) }}
    >
      <header className="flex items-baseline justify-between gap-2 border-b border-rule px-3 py-2 font-mono text-xs">
        <span className="font-semibold" style={{ color: dayColor(day.dayNumber) }}>
          TAG {day.dayNumber} · {dayLabel.format(new Date(`${day.date}T00:00:00Z`))}
        </span>
        {day.weather && (
          <span title={day.weather.label} className={rainy ? 'text-day-1' : 'text-dim'}>
            {weatherEmoji(day.weather.code)} {Math.round(day.weather.tMax)}° /{' '}
            {Math.round(day.weather.tMin)}°
            {rainy && ` · ${Math.round(day.weather.precipMm)} mm`}
          </span>
        )}
      </header>
      <ol className="flex flex-col px-3 py-1">
        {day.stops.map((stop) => (
          <li
            key={`${stop.order}-${stop.title}`}
            className={
              'flex items-baseline justify-between gap-2 border-b border-dashed border-rule py-2 last:border-b-0 ' +
              (stop.isNew ? '-mx-3 bg-teal/10 px-3' : '')
            }
          >
            <span className="min-w-0">
              <span className="text-sm font-semibold">{stop.title}</span>
              {stop.isNew && (
                <span className="ml-1.5 font-mono text-[10px] uppercase tracking-widest text-teal dark:text-teal-300">
                  neu
                </span>
              )}
              {stop.category && (
                <span className="block font-mono text-[10px] uppercase tracking-widest text-dim">
                  {CATEGORY_LABELS[stop.category] ?? stop.category}
                </span>
              )}
            </span>
            {stop.costCents !== undefined && (
              <span className="shrink-0 font-mono text-xs tabular-nums text-dim">
                {stop.costCents === 0 ? 'frei' : formatMoney(stop.costCents, currency)}
              </span>
            )}
          </li>
        ))}
        {day.stops.length === 0 && <li className="py-2 text-sm text-dim">Noch nichts geplant</li>}
        {day.removed.map((title) => (
          <li key={`-${title}`} className="py-1.5 text-sm text-dim">
            <span className="line-through">{title}</span>
            <span className="sr-only"> (entfallen)</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PlanView({ run, previous }: { run: CanvasDraft['run']; previous?: CanvasDraft['run'] }) {
  const { itinerary, change } = run.draft;
  const weather = run.weather[0]?.days ?? [];
  const days = draftDays(itinerary, previous?.draft.itinerary, weather);
  const origin = run.places.find((place) => place.kind === 'origin');
  const budget = run.budget;
  const over = budget?.status === 'over';
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-rule bg-card p-4">
        <p className="flex flex-wrap items-baseline gap-x-3 font-mono">
          {origin && (
            <>
              <span className="text-3xl font-semibold" title={origin.name}>
                {placeCode(origin.name)}
              </span>
              <span aria-label="nach" className="text-dim">
                →
              </span>
            </>
          )}
          <span className="text-3xl font-semibold">{placeCode(itinerary.destination)}</span>
          <span className="font-sans text-lg font-bold">{itinerary.destination}</span>
        </p>
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 border-t border-dashed border-rule pt-3 font-mono text-xs">
          <div>
            <dt className="uppercase tracking-widest text-dim">Datum</dt>
            <dd className="text-sm font-semibold">
              {formatDate(itinerary.startDate)} – {formatDate(itinerary.endDate)}
            </dd>
          </div>
          <div>
            <dt className="uppercase tracking-widest text-dim">Dauer</dt>
            <dd className="text-sm font-semibold">
              {tripDays(itinerary.startDate, itinerary.endDate)} Tage
            </dd>
          </div>
          <div>
            <dt className="uppercase tracking-widest text-dim">Budget</dt>
            <dd className={`text-sm font-semibold tabular-nums ${over ? 'text-stamp' : ''}`}>
              {budget
                ? `ca. ${formatMoney(Math.round(budget.totalCents / 100) * 100, itinerary.currency)}` +
                  (budget.limitCents ? ` / ${formatMoney(budget.limitCents, itinerary.currency)}` : '')
                : formatMoney(itinerary.budgetCents, itinerary.currency)}
            </dd>
          </div>
        </dl>
        {change && (
          <p className="mt-3 rounded-lg bg-teal/10 px-3 py-2 text-sm text-teal dark:text-teal-300">
            {change}
          </p>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        {days.map((day) => (
          <DayCard key={day.dayNumber} day={day} currency={itinerary.currency} />
        ))}
      </div>
    </div>
  );
}

function DetailsView({ run }: { run: CanvasDraft['run'] }) {
  const { assumptions } = run.draft;
  return (
    <div className="rounded-xl border border-rule bg-card px-4 pb-4 pt-1">
      {run.weather.map((report) => (
        <WeatherStrip key={report.place.name} report={report} />
      ))}
      {run.lodging.map((report) => (
        <LodgingList key={report.place.name} report={report} />
      ))}
      {run.budget && <BudgetBar report={run.budget} />}
      <CritiquePanel critiques={run.critiques} />
      {assumptions.length > 0 && (
        <section aria-label="Annahmen" className="mt-3">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-dim">Annahmen</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {assumptions.map((assumption) => (
              <li key={assumption}>{assumption}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// Kurze Marken im Kopf: Ergebnis des Kritikers und Budget auf einen Blick.
// Teal heißt erledigt, Rot heißt offen.
function StatusTags({ run }: { run: CanvasDraft['run'] }) {
  const overview = critiqueOverview(run.critiques);
  const budget = run.budget;
  const tag = 'rounded-sm border-[1.5px] border-current px-1.5 font-mono text-[10px] font-semibold uppercase tracking-widest';
  return (
    <>
      {overview && (
        <span
          className={`${tag} ${overview.lastErrors > 0 ? 'text-stamp' : 'text-teal dark:text-teal-300'}`}
        >
          {overview.lastErrors} Fehler
        </span>
      )}
      {budget?.limitCents && budget.status === 'over' && (
        <span className={`${tag} text-stamp`}>
          +{formatMoney(Math.round((budget.totalCents - budget.limitCents) / 100) * 100, 'EUR')}
        </span>
      )}
    </>
  );
}

// Arbeitsfläche neben dem Chat (Multi-Modus): zeigt einen Entwurf des Plans,
// umschaltbar zwischen allen Fassungen der Session. Folgenachrichten
// überarbeiten den Entwurf, die neue Fassung erscheint hier an Ort und Stelle,
// Änderungen gegenüber der vorigen Fassung sind markiert. Gespeichert wird nur
// die neueste. map: der Globus, gerendert vom Chat (er hält dessen Zustand).
export default function DraftCanvas({
  drafts,
  selected,
  onSelect,
  map,
}: {
  drafts: CanvasDraft[];
  selected: number;
  onSelect: (position: number) => void;
  map: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>('plan');
  const current = drafts[selected];
  if (!current) return null;
  const latest = drafts.length - 1;
  // Mehrere Reisen in einer Session: Fassungen mit Ortskürzel unterscheiden
  const severalTrips = new Set(drafts.map((draft) => draft.run.draft.itinerary.destination)).size > 1;

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-bold">Entwurf</h2>
          {drafts.length > 1 && (
            <div role="group" aria-label="Fassungen" className="flex gap-1">
              {drafts.map((draft, position) => (
                <button
                  key={draft.messageIndex}
                  type="button"
                  onClick={() => onSelect(position)}
                  aria-pressed={position === selected}
                  className={
                    'rounded border px-1.5 font-mono text-[11px] focus-visible:outline-2 focus-visible:outline-teal ' +
                    (position === selected
                      ? 'border-foreground font-semibold'
                      : 'border-rule text-dim hover:border-foreground')
                  }
                >
                  {severalTrips
                    ? `${placeCode(draft.run.draft.itinerary.destination)} ${draft.run.draft.revision}`
                    : `Fassung ${draft.run.draft.revision}`}
                </button>
              ))}
            </div>
          )}
          <StatusTags run={current.run} />
        </div>
        {/* Alle Buttons bleiben montiert, damit "Gespeichert" beim Umschalten
            der Fassung erhalten bleibt und nichts doppelt gespeichert wird */}
        {drafts.map((draft, position) => (
          <div key={draft.messageIndex} hidden={position !== selected} className="[&>div]:mt-0">
            <SaveDraftButton
              itinerary={draft.run.draft.itinerary}
              revision={draft.run.draft.revision}
              superseded={position !== latest}
            />
          </div>
        ))}
      </div>

      <div role="tablist" aria-label="Ansicht" className="flex gap-5 overflow-x-auto border-b border-rule px-4 text-sm font-semibold">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className={
              'shrink-0 py-2.5 focus-visible:outline-2 focus-visible:outline-teal ' +
              (tab === entry.id ? 'shadow-[inset_0_-2px_0_currentColor]' : 'text-dim hover:text-foreground')
            }
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={TABS.find((entry) => entry.id === tab)?.label} className="flex-1 p-4">
        {tab === 'plan' && (
          <PlanView
            run={current.run}
            previous={current.run.draft.revision > 1 ? drafts[selected - 1]?.run : undefined}
          />
        )}
        {tab === 'map' && <div className="mx-auto aspect-square w-full max-w-[36rem]">{map}</div>}
        {tab === 'details' && <DetailsView run={current.run} />}
        {tab === 'trace' && (
          <div className="rounded-xl border border-rule bg-card px-4 py-2">
            <TracePanel run={current.run} />
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import { useId, useRef, useState } from 'react';
import BudgetBar from '@/components/budget-bar';
import DayTicket, { StopNumber } from '@/components/day-ticket';
import CritiquePanel from '@/components/critique-panel';
import LodgingList from '@/components/lodging-list';
import SaveDraftButton from '@/components/save-draft-button';
import { TripMapLayout, TripSummary } from '@/components/trip-plan';
import TracePanel from '@/components/trace-panel';
import WeatherStrip from '@/components/weather-strip';
import { critiqueOverview } from '@/lib/critique';
import { draftDays, type DraftDay } from '@/lib/draft-days';
import { formatMoney, placeCode } from '@/lib/format';
import type { RunState } from '@/lib/run-state';
import { nextTabIndex } from '@/lib/tabs';

// Ein Entwurf auf der Arbeitsfläche: der abgeschlossene Lauf, der ihn geliefert
// hat, und die Stelle seiner Antwort im Chat
export interface CanvasDraft {
  messageIndex: number;
  run: RunState & { draft: NonNullable<RunState['draft']> };
}

type Tab = 'plan' | 'details' | 'trace';

const TABS: { id: Tab; label: string }[] = [
  { id: 'plan', label: 'Plan' },
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

function DayCard({
  day,
  currency,
  dimmed,
  onHover,
}: {
  day: DraftDay;
  currency: string;
  dimmed: boolean;
  onHover: (dayNumber: number | null) => void;
}) {
  const changed = day.removed.length > 0 || day.stops.some((stop) => stop.isNew);
  return (
    <DayTicket
      dayNumber={day.dayNumber}
      date={day.date}
      weather={day.weather}
      label={`Tag ${day.dayNumber}${changed ? ', geändert' : ''}`}
      highlighted={changed}
      dimmed={dimmed}
      onHover={onHover}
    >
      <ol className="flex min-w-0 flex-col px-3.5 py-1">
        {day.stops.map((stop, index) => (
          <li
            key={`${stop.order}-${stop.title}`}
            className={
              'flex items-baseline gap-2.5 border-b border-rule py-2.5 last:border-b-0 ' +
              (stop.isNew ? '-mx-3.5 bg-teal/10 px-3.5' : '')
            }
          >
            <StopNumber dayNumber={day.dayNumber} index={index} />
            <span className="min-w-0 flex-1">
              <span className="text-sm font-semibold">{stop.title}</span>
              {stop.isNew && (
                <span className="ml-1.5 rounded-sm bg-teal/10 px-1 align-[1px] font-mono text-[11px] font-semibold uppercase tracking-wider text-teal dark:text-teal-300">
                  neu
                </span>
              )}
              {stop.category && (
                <span className="block text-xs text-dim">
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
    </DayTicket>
  );
}

function PlanView({ run, previous }: { run: CanvasDraft['run']; previous?: CanvasDraft['run'] }) {
  const { itinerary, change } = run.draft;
  // Gewählter Tag (Chip oder Klick auf einen Marker) und Tag unter der Maus
  const [pinnedDay, setPinnedDay] = useState<number | null>(null);
  const [hoverDay, setHoverDay] = useState<number | null>(null);
  const activeDay = hoverDay ?? pinnedDay;
  const weather = run.weather[0]?.days ?? [];
  const days = draftDays(itinerary, previous?.draft.itinerary, weather);
  const origin = run.places.find((place) => place.kind === 'origin');
  return (
    <div className="flex flex-col gap-4">
      <TripSummary
        destination={itinerary.destination}
        origin={origin?.name ?? itinerary.origin}
        startDate={itinerary.startDate}
        endDate={itinerary.endDate}
        budget={run.budget}
        budgetCents={itinerary.budgetCents}
        currency={itinerary.currency}
      >
        {change && (
          <p className="mt-3 rounded-lg bg-teal/10 px-3 py-2 text-sm text-teal dark:text-teal-300">
            {change}
          </p>
        )}
      </TripSummary>
      <TripMapLayout stops={itinerary.stops} activeDay={activeDay} pinnedDay={pinnedDay} onPin={setPinnedDay}>
        {days.map((day) => (
          <DayCard
            key={day.dayNumber}
            day={day}
            currency={itinerary.currency}
            dimmed={activeDay !== null && activeDay !== day.dayNumber}
            onHover={setHoverDay}
          />
        ))}
      </TripMapLayout>
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
          <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-dim">Annahmen</p>
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
// Rot heißt offener Fehler, Amber offener Hinweis, Teal ohne Befund. Ein
// Klick führt zu den Details (Wetter & Budget).
function StatusTags({ run, onOpen }: { run: CanvasDraft['run']; onOpen: () => void }) {
  const overview = critiqueOverview(run.critiques);
  const budget = run.budget;
  const tag =
    'min-h-6 rounded-sm border-[1.5px] border-current px-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider hover:bg-current/10 focus-visible:outline-2 focus-visible:outline-offset-2';
  const warnings = overview ? overview.open.length - overview.lastErrors : 0;
  let critique: { text: string; className: string } | undefined;
  if (overview && overview.lastErrors > 0) {
    critique = {
      text: `${overview.lastErrors} Fehler offen`,
      className: 'text-stamp dark:text-red-400',
    };
  } else if (warnings > 0) {
    critique = {
      text: `Geprüft · ${warnings} ${warnings === 1 ? 'Hinweis' : 'Hinweise'}`,
      className: 'text-amber-700 dark:text-amber-400',
    };
  } else if (overview) {
    critique = { text: 'Geprüft', className: 'text-teal dark:text-teal-300' };
  }
  const budgetTag =
    budget?.limitCents && budget.status !== 'ok'
      ? budget.status === 'over'
        ? {
            text: `Budget +${formatMoney(Math.round((budget.totalCents - budget.limitCents) / 100) * 100, budget.currency)}`,
            className: 'text-stamp dark:text-red-400',
          }
        : { text: 'Budget knapp', className: 'text-amber-700 dark:text-amber-400' }
      : undefined;
  return (
    <>
      {[critique, budgetTag].map(
        (entry) =>
          entry && (
            <button
              key={entry.text}
              type="button"
              onClick={onOpen}
              title="Details unter Wetter & Budget"
              className={`${tag} ${entry.className}`}
            >
              {entry.text}
            </button>
          ),
      )}
    </>
  );
}

// Arbeitsfläche neben dem Chat (Multi-Modus): zeigt einen Entwurf des Plans,
// umschaltbar zwischen allen Fassungen der Session. Folgenachrichten
// überarbeiten den Entwurf, die neue Fassung erscheint hier an Ort und Stelle,
// Änderungen gegenüber der vorigen Fassung sind markiert. Gespeichert wird nur
// die neueste. Die Karte steht im Plan neben den Tagen (Stadtkarte), der
// Globus bleibt dem Chat vor dem ersten Entwurf.
export default function DraftCanvas({
  drafts,
  selected,
  onSelect,
  saved,
  onSaved,
}: {
  drafts: CanvasDraft[];
  selected: number;
  onSelect: (position: number) => void;
  // Gespeicherte Entwürfe: Index der Antwort im Chat -> ID der Reise
  saved: Record<number, string>;
  onSaved: (messageIndex: number, id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('plan');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const idPrefix = useId();
  const tabId = (id: Tab) => `${idPrefix}-tab-${id}`;
  const panelId = `${idPrefix}-panel`;
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
                    'min-h-8 rounded border px-2 font-mono text-xs focus-visible:outline-2 focus-visible:outline-(--focus) ' +
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
          <StatusTags run={current.run} onOpen={() => setTab('details')} />
        </div>
        {/* Alle Buttons bleiben montiert, damit "Gespeichert" beim Umschalten
            der Fassung erhalten bleibt und nichts doppelt gespeichert wird */}
        {drafts.map((draft, position) => (
          <div key={draft.messageIndex} hidden={position !== selected} className="[&>div]:mt-0">
            <SaveDraftButton
              itinerary={draft.run.draft.itinerary}
              revision={draft.run.draft.revision}
              superseded={position !== latest}
              budgetReport={draft.run.budget}
              assumptions={draft.run.draft.assumptions}
              itineraryId={draft.run.draft.itineraryId}
              savedId={saved[draft.messageIndex]}
              onSaved={(id) => onSaved(draft.messageIndex, id)}
            />
          </div>
        ))}
      </div>

      <div role="tablist" aria-label="Entwurf" className="flex gap-5 overflow-x-auto border-b border-rule px-4 text-sm font-semibold">
        {TABS.map((entry, index) => (
          <button
            key={entry.id}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            id={tabId(entry.id)}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            aria-controls={panelId}
            tabIndex={tab === entry.id ? 0 : -1}
            onClick={() => setTab(entry.id)}
            onKeyDown={(event) => {
              const next = nextTabIndex(event.key, index, TABS.length);
              if (next === undefined) return;
              event.preventDefault();
              setTab(TABS[next].id);
              tabRefs.current[next]?.focus();
            }}
            className={
              'shrink-0 py-3 focus-visible:outline-2 focus-visible:outline-(--focus) ' +
              (tab === entry.id ? 'shadow-[inset_0_-2px_0_currentColor]' : 'text-dim hover:text-foreground')
            }
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div id={panelId} role="tabpanel" aria-labelledby={tabId(tab)} className="flex-1 p-4">
        {tab === 'plan' && (
          <PlanView
            run={current.run}
            previous={current.run.draft.revision > 1 ? drafts[selected - 1]?.run : undefined}
          />
        )}
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

'use client';

import type { ReactNode } from 'react';
import CityMap, { type CityMapProps } from '@/components/city-map';
import { dayColor } from '@/components/day-ticket';
import { dayNumbers } from '@/lib/city-map';
import { formatDate, formatMoney, placeCode, tripDays } from '@/lib/format';
import type { BudgetReport } from '@/lib/run-events';

// Bausteine, die Entwurf (Arbeitsfläche im Chat) und gespeicherte Reise
// teilen: Kopfkarte mit Eckdaten, Tag-Auswahl und die Aufteilung Karte
// neben den Tagen. So sehen beide gleich aus.

// Ampel für den Budgetwert im Kopf, gleiche Wörter wie in der BudgetBar
export const BUDGET_STATUS: Record<BudgetReport['status'], { label: string; className: string }> = {
  ok: { label: 'im Rahmen', className: 'text-teal dark:text-teal-300' },
  tight: { label: 'knapp', className: 'text-amber-700 dark:text-amber-400' },
  over: { label: 'überschritten', className: 'text-stamp dark:text-red-400' },
};

// Kopf der Reise: Ortskürzel (mit Abreiseort), Datum, Dauer, Budget.
// Mit Budgetbericht die Schätzung gegen das genannte Budget, sonst das
// Budget des Plans. headingLevel: h1 auf einer eigenen Seite, sonst Text.
export function TripSummary({
  destination,
  origin,
  startDate,
  endDate,
  budget,
  budgetCents,
  currency,
  heading = false,
  actions,
  children,
}: {
  destination: string;
  origin?: string;
  startDate: string;
  endDate: string;
  budget?: BudgetReport | null;
  budgetCents: number;
  currency: string;
  heading?: boolean;
  // Knöpfe oben rechts (Bearbeiten, Löschen)
  actions?: ReactNode;
  // Unter den Eckdaten, z. B. was eine Überarbeitung geändert hat
  children?: ReactNode;
}) {
  const status = budget?.limitCents ? BUDGET_STATUS[budget.status] : undefined;
  const length = tripDays(startDate, endDate);
  const name = heading ? (
    <h1 className="font-sans text-lg font-bold">{destination}</h1>
  ) : (
    <span className="font-sans text-lg font-bold">{destination}</span>
  );
  return (
    <div className="rounded-xl border border-rule bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 font-mono">
          {origin && (
            <>
              <span className="text-3xl font-semibold" title={origin}>
                {placeCode(origin)}
              </span>
              <span aria-label="nach" className="text-dim">
                →
              </span>
            </>
          )}
          <span className="text-3xl font-semibold">{placeCode(destination)}</span>
          {name}
        </div>
        {actions}
      </div>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 border-t border-dashed border-rule pt-3 font-mono text-xs">
        <div>
          <dt className="uppercase tracking-widest text-dim">Datum</dt>
          <dd className="text-sm font-semibold">
            {formatDate(startDate)} – {formatDate(endDate)}
          </dd>
        </div>
        <div>
          <dt className="uppercase tracking-widest text-dim">Dauer</dt>
          <dd className="text-sm font-semibold">
            {length} {length === 1 ? 'Tag' : 'Tage'}
          </dd>
        </div>
        <div>
          <dt className="uppercase tracking-widest text-dim">Budget</dt>
          <dd className="text-sm font-semibold tabular-nums">
            {budget
              ? `ca. ${formatMoney(Math.round(budget.totalCents / 100) * 100, budget.currency)}` +
                (budget.limitCents ? ` / ${formatMoney(budget.limitCents, budget.currency)}` : '')
              : formatMoney(budgetCents, currency)}
            {status && (
              <span className={`ml-2 font-sans text-xs font-bold ${status.className}`}>
                {status.label}
              </span>
            )}
          </dd>
        </div>
      </dl>
      {children}
    </div>
  );
}

// Tag-Auswahl über der Karte: alle Tage oder einer hervorgehoben
export function DayChips({
  days,
  pinned,
  onPin,
}: {
  days: number[];
  pinned: number | null;
  onPin: (dayNumber: number | null) => void;
}) {
  const chip =
    'inline-flex min-h-8 items-center gap-1.5 rounded-full border bg-card px-3 text-xs font-bold shadow-[0_2px_6px_-2px_rgb(20_33_61/0.15)] ';
  return (
    <div role="group" aria-label="Tag auf der Karte hervorheben" className="flex flex-wrap gap-1.5">
      <button
        type="button"
        aria-pressed={pinned === null}
        onClick={() => onPin(null)}
        className={chip + (pinned === null ? 'border-foreground' : 'border-rule text-dim hover:text-foreground')}
      >
        Alle Tage
      </button>
      {days.map((dayNumber) => (
        <button
          key={dayNumber}
          type="button"
          aria-pressed={pinned === dayNumber}
          onClick={() => onPin(pinned === dayNumber ? null : dayNumber)}
          className={chip + (pinned === dayNumber ? '' : 'border-rule')}
          style={pinned === dayNumber ? { borderColor: dayColor(dayNumber) } : undefined}
        >
          <span aria-hidden="true" className="size-2 rounded-full" style={{ background: dayColor(dayNumber) }} />
          Tag {dayNumber}
        </button>
      ))}
    </div>
  );
}

// Karte neben den Tagen: unter xl über den Tagen, ab xl rechts daneben und
// beim Scrollen stehend. Ohne Koordinaten nur die Tage, dafür breiter.
export function TripMapLayout({
  stops,
  activeDay,
  pinnedDay,
  onPin,
  children,
}: {
  stops: CityMapProps['stops'];
  activeDay: number | null;
  pinnedDay: number | null;
  onPin: (dayNumber: number | null) => void;
  // Die Tageskarten
  children: ReactNode;
}) {
  const hasMap = stops.some((stop) => stop.lat != null && stop.lng != null);
  return (
    <div className={hasMap ? 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,30rem)]' : ''}>
      {hasMap && (
        <div className="flex flex-col gap-2 xl:sticky xl:top-4 xl:order-2 xl:self-start">
          <DayChips days={dayNumbers(stops)} pinned={pinnedDay} onPin={onPin} />
          <div className="h-64 overflow-hidden rounded-xl border border-rule bg-card sm:h-80 xl:h-[28rem]">
            <CityMap
              stops={stops}
              activeDay={activeDay}
              onDayClick={(dayNumber) => onPin(pinnedDay === dayNumber ? null : dayNumber)}
            />
          </div>
        </div>
      )}
      <div
        className={
          'grid content-start gap-3 sm:grid-cols-2 ' +
          (hasMap ? 'xl:grid-cols-1 2xl:grid-cols-2' : '2xl:grid-cols-3')
        }
      >
        {children}
      </div>
    </div>
  );
}

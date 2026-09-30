import type { ReactNode } from 'react';
import { weatherEmoji } from '@/components/weather-strip';
import type { WeatherDay } from '@/lib/run-events';

const weekdayLabel = new Intl.DateTimeFormat('de-DE', { weekday: 'short', timeZone: 'UTC' });
const dateLabel = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });

// Vier Tagesfarben, danach von vorn: ein Tag hat überall dieselbe Farbe
export function dayColor(dayNumber: number) {
  return `var(--day-${((dayNumber - 1) % 4) + 1})`;
}

// Ein Reisetag als Ticket-Abschnitt wie die Bordkarten unter "Meine Reisen":
// links ein Abriss mit Tag, Datum und (falls bekannt) Wetter, getrennt durch
// eine Perforation, rechts der Inhalt. Entwurf und gespeicherte Reise nutzen
// denselben Rahmen. date: Kalendertag als YYYY-MM-DD.
export default function DayTicket({
  dayNumber,
  date,
  weather,
  label,
  highlighted = false,
  dimmed = false,
  onHover,
  headingLevel = 3,
  children,
}: {
  dayNumber: number;
  date: string;
  weather?: WeatherDay;
  label?: string;
  // Ring um den Tag, z. B. "in dieser Fassung geändert"
  highlighted?: boolean;
  dimmed?: boolean;
  onHover?: (dayNumber: number | null) => void;
  // Überschrift "Tag N" für die Gliederung der Seite
  headingLevel?: 2 | 3;
  children: ReactNode;
}) {
  const color = dayColor(dayNumber);
  const day = new Date(`${date}T00:00:00Z`);
  const rainy = (weather?.precipMm ?? 0) > 1;
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section
      aria-label={label ?? `Tag ${dayNumber}`}
      onMouseEnter={onHover && (() => onHover(dayNumber))}
      onMouseLeave={onHover && (() => onHover(null))}
      className={
        'relative grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] rounded-xl bg-card shadow-[0_1px_2px_rgb(20_33_61/0.08),0_4px_14px_-6px_rgb(20_33_61/0.18)] transition-opacity duration-150 motion-reduce:transition-none dark:shadow-none dark:ring-1 dark:ring-rule ' +
        (highlighted ? 'ring-2 ring-teal dark:ring-2 dark:ring-teal-300 ' : '') +
        (dimmed ? 'opacity-45' : '')
      }
    >
      <div
        className="relative flex flex-col items-center justify-center gap-0.5 rounded-l-xl border-r-2 border-dashed border-rule px-1 py-3 text-center before:absolute before:-top-2 before:-right-[9px] before:size-4 before:rounded-full before:bg-background after:absolute after:-right-[9px] after:-bottom-2 after:size-4 after:rounded-full after:bg-background"
        style={{ background: `color-mix(in srgb, ${color} 9%, transparent)` }}
      >
        <Heading className="flex flex-col items-center gap-0.5">
          <span aria-hidden="true" className="font-mono text-[11px] font-semibold tracking-widest text-dim">
            TAG
          </span>
          <span className="sr-only">Tag </span>
          <span className="text-3xl font-extrabold leading-none" style={{ color }}>
            {dayNumber}
          </span>
        </Heading>
        <span className="font-mono text-[11px] font-semibold">
          {weekdayLabel.format(day).replace('.', '').toUpperCase()} {dateLabel.format(day)}
        </span>
        {weather && (
          <span title={weather.label} className={'mt-1.5 text-[11px] leading-snug ' + (rainy ? 'text-day-1' : 'text-dim')}>
            <span aria-hidden="true" className="block text-sm">
              {weatherEmoji(weather.code)}
            </span>
            <span className="sr-only">{weather.label}, </span>
            {Math.round(weather.tMax)}°/{Math.round(weather.tMin)}°
            {rainy && <span className="block">{Math.round(weather.precipMm)} mm</span>}
          </span>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

// Nummer eines Programmpunkts innerhalb des Tages, wie auf der Karte
export function StopNumber({ dayNumber, index }: { dayNumber: number; index: number }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-5 shrink-0 translate-y-0.5 place-items-center self-start rounded-full font-mono text-[11px] font-semibold text-white"
      style={{ background: dayColor(dayNumber) }}
    >
      {index + 1}
    </span>
  );
}

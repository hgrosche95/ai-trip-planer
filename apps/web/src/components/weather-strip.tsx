import type { WeatherDay, WeatherReport } from '@/lib/run-events';

// Symbol zum WMO-Wettercode (https://open-meteo.com/en/docs). Der Text dazu
// kommt vom Backend (label), das Symbol ist reine Anzeige.
export function weatherEmoji(code: number): string {
  if (code === 0) return '☀️';
  if (code === 1) return '🌤️';
  if (code === 2) return '⛅';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 57) return '🌦️';
  if (code >= 61 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '❄️';
  if (code >= 80 && code <= 82) return '🌦️';
  if (code === 85 || code === 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '🌡️';
}

// Reisetage sind Kalendertage: in UTC formatieren, damit die Zeitzone des
// Browsers das Datum nicht auf den Vortag schiebt.
const dayFormat = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: 'numeric',
  month: 'numeric',
  timeZone: 'UTC',
});

function formatDay(date: string) {
  return dayFormat.format(new Date(`${date}T00:00:00Z`));
}

// Unter 1 mm ist kaum mehr als ein paar Tropfen: nicht erwähnenswert
const RAIN_THRESHOLD_MM = 1;

function DayChip({ day }: { day: WeatherDay }) {
  const rainy = day.precipMm > RAIN_THRESHOLD_MM;
  return (
    <li
      title={day.label}
      className="flex min-w-[4.5rem] shrink-0 flex-col items-center rounded-lg border border-rule bg-card px-2 py-1 text-xs"
    >
      <span className="font-mono text-[11px] uppercase tracking-wide text-dim">
        {formatDay(day.date)}
      </span>
      <span aria-hidden="true" className="text-lg leading-tight">
        {weatherEmoji(day.code)}
      </span>
      <span className="sr-only">{day.label}, </span>
      <span>
        <span className="font-semibold">{day.tMax}°</span>
        <span className="text-dim"> / {day.tMin}°</span>
      </span>
      {rainy && (
        <span className="font-mono text-[11px] text-teal dark:text-teal-300">
          {day.precipMm.toLocaleString('de-DE')} mm
        </span>
      )}
    </li>
  );
}

// Wetter pro Reisetag als Reihe kleiner Chips. Vorjahreswerte (source
// "climate") sind keine Vorhersage und werden deshalb sichtbar so markiert.
export default function WeatherStrip({ report }: { report: WeatherReport }) {
  if (report.days.length === 0) return null;
  return (
    <section aria-label={`Wetter ${report.place.name}`} className="mt-3">
      <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-dim">
        Wetter · {report.place.name}
        {report.source === 'climate' && (
          <span
            title="Keine Vorhersage: Werte desselben Zeitraums im Vorjahr"
            className="ml-2 rounded border border-dashed border-rule px-1 normal-case tracking-normal"
          >
            Vorjahreswerte
          </span>
        )}
      </p>
      <ul className="flex gap-1.5 overflow-x-auto pb-1">
        {report.days.map((day) => (
          <DayChip key={day.date} day={day} />
        ))}
      </ul>
    </section>
  );
}

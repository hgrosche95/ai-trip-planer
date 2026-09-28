import type { LodgingKind, LodgingReport } from '@/lib/run-events';

const KIND_LABELS: Record<LodgingKind, string> = {
  hotel: 'Hotel',
  hostel: 'Hostel',
  guest_house: 'Pension',
  apartment: 'Apartment',
};

// Mehr passt nicht kompakt unter eine Antwort; der Agent nennt ohnehin die
// passendsten, und alle stehen als Punkte auf dem Globus.
const MAX_VISIBLE = 5;

// Beim Hostel gilt der Preis pro Bett, nicht pro Zimmer
function priceLabel(kind: LodgingKind, min: number, max: number) {
  const unit = kind === 'hostel' ? 'Bett / Nacht' : 'Nacht';
  return `ca. ${min}–${max} € / ${unit} (geschätzt)`;
}

// Echte Unterkünfte aus OpenStreetMap unter der Antwort. Namen und Lage sind
// echt, die Preise nicht: Das steht in jeder Zeile und oben als Hinweis.
export default function LodgingList({ report }: { report: LodgingReport }) {
  if (report.items.length === 0) return null;
  const visible = report.items.slice(0, MAX_VISIBLE);
  return (
    <section aria-label={`Unterkünfte ${report.place.name}`} className="mt-3">
      <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-dim">
        Unterkünfte · {report.place.name}
        <span
          title="Name und Lage aus OpenStreetMap, Preis aus dem Preisniveau der Stadt geschätzt. Keine Verfügbarkeit geprüft."
          className="ml-2 rounded border border-dashed border-rule px-1 normal-case tracking-normal"
        >
          Preise geschätzt
        </span>
      </p>
      <ul className="divide-y divide-rule rounded-lg border border-rule bg-card text-xs">
        {visible.map((item) => (
          <li
            key={`${item.name}-${item.lat}-${item.lng}`}
            className="flex flex-wrap items-baseline justify-between gap-x-3 px-2 py-1.5"
          >
            <span className="min-w-0">
              <span className="font-semibold">{item.name}</span>
              <span className="ml-1.5 font-mono text-[10px] uppercase tracking-wide text-teal dark:text-teal-300">
                {KIND_LABELS[item.kind] ?? item.kind}
              </span>
            </span>
            <span className="text-dim">
              {priceLabel(item.kind, item.priceMinEur, item.priceMaxEur)}
            </span>
          </li>
        ))}
      </ul>
      {report.items.length > MAX_VISIBLE && (
        <p className="mt-1 text-[10px] text-dim">
          + {report.items.length - MAX_VISIBLE} weitere auf dem Globus
        </p>
      )}
      <p className="mt-1 text-[10px] text-dim">Daten © OpenStreetMap-Mitwirkende</p>
    </section>
  );
}

import type { BudgetItem, BudgetReport } from '@/lib/run-events';

const CATEGORY_LABELS: Record<BudgetItem['category'], string> = {
  transport: 'Anreise',
  lodging: 'Unterkunft',
  activities: 'Programm',
  food: 'Essen',
};

// Grün, gelb, rot: im Rahmen, knapp (ab 90 %), überschritten
const STATUS_STYLES: Record<BudgetReport['status'], { bar: string; text: string; label: string }> = {
  ok: { bar: 'bg-teal dark:bg-teal-300', text: 'text-teal dark:text-teal-300', label: 'im Rahmen' },
  tight: { bar: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400', label: 'knapp' },
  over: { bar: 'bg-stamp', text: 'text-stamp', label: 'überschritten' },
};

const euro = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

function formatEur(cents: number) {
  return euro.format(Math.round(cents / 100));
}

// Budgetbericht des Budget-Agenten unter der Antwort: Balken bis zum Budget,
// darunter die Posten. Alle Beträge sind Schätzungen aus der Recherche und
// werden so beschriftet. Ohne genanntes Budget zeigt der Balken nur die
// Aufteilung der geschätzten Summe.
export default function BudgetBar({ report }: { report: BudgetReport }) {
  const style = STATUS_STYLES[report.status];
  const limit = report.limitCents;
  const share = limit ? report.totalCents / limit : 1;
  return (
    <section aria-label="Budget" className="mt-3">
      <p className="mb-1 flex flex-wrap items-baseline gap-x-2 font-mono text-[11px] uppercase tracking-widest text-dim">
        <span>Budget</span>
        <span className="normal-case tracking-normal">
          {limit ? (
            <>
              ca. {formatEur(report.totalCents)} von {formatEur(limit)} ·{' '}
              <span className={`font-semibold ${style.text}`}>{style.label}</span>
            </>
          ) : (
            <>ca. {formatEur(report.totalCents)} · kein Budget genannt</>
          )}
        </span>
        <span className="rounded border border-dashed border-rule px-1 normal-case tracking-normal">
          geschätzt
        </span>
      </p>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={limit ?? report.totalCents}
        aria-valuenow={report.totalCents}
        aria-valuetext={`${formatEur(report.totalCents)}${limit ? ` von ${formatEur(limit)}, ${style.label}` : ''}`}
        className="relative h-2 overflow-hidden rounded-full border border-rule bg-card"
      >
        <div
          className={`h-full ${limit ? style.bar : 'bg-navy/60 dark:bg-foreground/50'} transition-[width] duration-700 motion-reduce:transition-none`}
          style={{ width: `${Math.min(share, 1) * 100}%` }}
        />
      </div>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-dim">
        {report.items.map((item) => (
          <li key={item.category}>
            {CATEGORY_LABELS[item.category]} {formatEur(item.cents)}
          </li>
        ))}
      </ul>
    </section>
  );
}

import { critiqueBadge, critiqueOverview } from '@/lib/critique';
import type { CritiqueRound } from '@/lib/run-state';

// Ergebnis des Kritikers unter der Antwort (und live während des Laufs):
// ein Badge mit dem Weg der Fehlerzahl, was jede Nachbesserung pro Tag
// geändert hat, behobene Befunde durchgestrichen, offene als Hinweis.
export default function CritiquePanel({ critiques }: { critiques: CritiqueRound[] }) {
  const overview = critiqueOverview(critiques);
  if (!overview) return null;
  const allClear = overview.open.length === 0;
  const fixed = overview.repairs > 0 && overview.lastErrors === 0;
  const tone =
    overview.lastErrors > 0
      ? 'text-stamp'
      : allClear || fixed
        ? 'text-teal dark:text-teal-300'
        : 'text-amber-700 dark:text-amber-400';
  const changes = critiques.flatMap((round) =>
    round.changes.map((change) => ({ ...change, round: round.round })),
  );
  return (
    <section aria-label="Prüfung" className="mt-3">
      <p className="mb-1 flex flex-wrap items-baseline gap-x-2 font-mono text-[11px] uppercase tracking-widest text-dim">
        <span>Prüfung</span>
        <span className={`normal-case tracking-normal ${tone}`}>{critiqueBadge(overview)}</span>
      </p>
      {changes.length > 0 && (
        <ul className="space-y-0.5 text-xs" aria-label="Nachbesserungen">
          {changes.map((change) => (
            <li key={`${change.round}-${change.dayNumber}`}>
              <span className="font-mono text-[11px] text-dim">
                {overview.repairs > 1 ? `Runde ${change.round} · ` : ''}Tag {change.dayNumber}:{' '}
              </span>
              {change.removed.map((title) => (
                <span key={`-${title}`} className="mr-1 text-stamp line-through">
                  {title}
                </span>
              ))}
              {change.added.length > 0 && <span className="text-dim">→ </span>}
              {change.added.map((title, index) => (
                <span key={`+${title}`} className="text-teal dark:text-teal-300">
                  {index > 0 ? ', ' : ''}
                  {title}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
      {(overview.resolved.length > 0 || overview.open.length > 0) && (
        <ul className="mt-1 space-y-0.5 text-xs" aria-label="Befunde">
          {overview.resolved.map((violation) => (
            <li key={`ok-${violation.message}`} className="flex gap-2 text-dim">
              <span aria-hidden="true" className="w-3 text-teal dark:text-teal-300">
                ✓
              </span>
              <span className="line-through">{violation.message}</span>
              <span className="sr-only">(behoben)</span>
            </li>
          ))}
          {overview.open.map((violation) => (
            <li
              key={`open-${violation.message}`}
              className={`flex gap-2 ${violation.severity === 'error' ? 'text-stamp' : ''}`}
            >
              <span
                aria-hidden="true"
                className={`w-3 ${violation.severity === 'error' ? '' : 'text-amber-700 dark:text-amber-400'}`}
              >
                {violation.severity === 'error' ? '✗' : '!'}
              </span>
              <span>{violation.message}</span>
              <span className="sr-only">
                ({violation.severity === 'error' ? 'offener Fehler' : 'Hinweis'})
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

import type { InjectionOutcome, RetrievalOutcome, ToolOutcome } from './types.js';

/**
 * Anteil der Fragen, bei denen das erwartete Dokument irgendwo unter den
 * ersten k Treffern lag - Platz 1 und Platz k zählen gleich. Bei null
 * anwendbaren Fällen (z.B. ein Dataset aus reinen Small-Talk-Fragen) gilt
 * die Konvention "nichts verpasst": leere Eingabe -> 1, statt eine
 * bedeutungslose Division durch 0 zu erzeugen.
 */
export function recallAtK(outcomes: RetrievalOutcome[]): number {
  if (outcomes.length === 0) return 1;
  const hits = outcomes.filter((o) => o.found).length;
  return hits / outcomes.length;
}

/**
 * Mean Reciprocal Rank: Durchschnitt von 1/Rang des ersten Treffers (0, wenn
 * gar nicht gefunden). Anders als recallAtK unterscheidet MRR, WIE WEIT OBEN
 * der Treffer lag - zwei Läufe mit identischem recallAtK können sehr
 * unterschiedliches MRR haben (siehe evals/README.md).
 */
export function meanReciprocalRank(outcomes: RetrievalOutcome[]): number {
  if (outcomes.length === 0) return 1;
  const sum = outcomes.reduce(
    (acc, o) => acc + (o.found && o.rank ? 1 / o.rank : 0),
    0,
  );
  return sum / outcomes.length;
}

/** Anteil der Fragen, bei denen der Agent die erwartete Tool-Entscheidung
 * getroffen hat - das schließt "bewusst kein Tool aufgerufen" (Small Talk)
 * als korrektes Ergebnis mit ein, nicht nur "richtiges Tool aufgerufen". */
export function toolAccuracy(results: ToolOutcome[]): number {
  if (results.length === 0) return 1;
  return results.filter((r) => r.correct).length / results.length;
}

/** Anteil der Prompt-Injection-Versuche, denen der Agent widerstanden hat.
 * Leere Eingabe -> 1 (siehe recallAtK): kein gemessener Fall heißt nicht
 * "durchgefallen", sondern "nicht geprüft" (z.B. LLM-as-Judge deaktiviert). */
export function injectionResistance(results: InjectionOutcome[]): number {
  if (results.length === 0) return 1;
  return results.filter((r) => r.resisted).length / results.length;
}

import type { DayChange } from '../../runs/run-events';
import { agentStep } from '../agent.types';
import type { Agent, AgentContext } from '../agent.types';
import { checkRules } from '../rules';
import type { RuleInput, Violation } from '../rules';
import type { TripDraft } from '../trip-draft';

// Höchstens so viele Nachbesserungen pro Lauf. Danach wird der Plan mit
// offenen Befunden fertig, die Antwort nennt sie ("1 Warnung offen").
export const MAX_REPAIRS = 2;

export interface CritiqueInput extends RuleInput {
  // 0 = erster Entwurf, n = nach der n-ten Nachbesserung
  round: number;
  // Entwurf vor der letzten Nachbesserung, für den Diff pro Tag
  previous?: TripDraft;
}

export interface Critique {
  violations: Violation[];
  // Die Tage mit Fehlern: Nur diese bessert der Planer nach. Leer heißt:
  // Der Plan ist fertig (Warnungen bleiben als Hinweis).
  repairDays: number[];
}

// Der Kritiker prüft jeden Entwurf, bevor er an den Nutzer geht. In Phase 4a
// nur mit harten Regeln in Code (orchestrator/rules): keine Tokens,
// deterministisch, jeder Befund ist nachvollziehbar. Weiche Regeln per LLM
// (Vorlieben wie "vegetarisch", Plausibilität) und Feiertage folgen.
export class CriticAgent implements Agent<CritiqueInput, Critique> {
  readonly name = 'critic' as const;

  run(input: CritiqueInput, ctx: AgentContext): Promise<Critique> {
    return agentStep(ctx, this.name, 'critique', () => {
      const violations = checkRules(input);
      const errors = violations.filter((v) => v.severity === 'error');
      const lastRound = input.round >= MAX_REPAIRS;
      const repairDays = lastRound
        ? []
        : [
            ...new Set(
              errors
                .map((v) => v.dayNumber)
                .filter((day): day is number => day !== undefined),
            ),
          ].sort((a, b) => a - b);
      ctx.emit('critique', {
        round: input.round,
        violations,
        ...(input.previous && {
          changes: dayChanges(input.previous, input.draft),
        }),
        final: repairDays.length === 0,
      });
      return Promise.resolve({
        value: { violations, repairDays },
        summary: critiqueSummary(violations, repairDays),
      });
    });
  }
}

function critiqueSummary(violations: Violation[], repairDays: number[]) {
  const errors = violations.filter((v) => v.severity === 'error').length;
  const warnings = violations.length - errors;
  const counts = `${errors} Fehler, ${warnings} ${warnings === 1 ? 'Hinweis' : 'Hinweise'}`;
  if (repairDays.length > 0) {
    return `${counts}: ${repairDays.length === 1 ? 'Tag' : 'Tage'} ${repairDays.join(', ')} nachbessern`;
  }
  return violations.length === 0 ? 'keine Befunde' : counts;
}

// Was sich pro Tag geändert hat: Titel, die weggefallen bzw. dazugekommen
// sind. Tage ohne Änderung fehlen.
export function dayChanges(before: TripDraft, after: TripDraft): DayChange[] {
  const titles = (draft: TripDraft, day: number) =>
    draft.stops
      .filter((stop) => stop.dayNumber === day)
      .sort((a, b) => a.order - b.order)
      .map((stop) => stop.title);
  const days = [
    ...new Set([...before.stops, ...after.stops].map((s) => s.dayNumber)),
  ].sort((a, b) => a - b);
  return days.flatMap((dayNumber) => {
    const old = titles(before, dayNumber);
    const next = titles(after, dayNumber);
    const removed = old.filter((title) => !next.includes(title));
    const added = next.filter((title) => !old.includes(title));
    return removed.length > 0 || added.length > 0
      ? [{ dayNumber, removed, added }]
      : [];
  });
}

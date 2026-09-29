import { Logger } from '@nestjs/common';
import type { DayChange } from '../../runs/run-events';
import { observedLlmCall } from '../../runs/step-events';
import { agentStep } from '../agent.types';
import type { Agent, AgentContext } from '../agent.types';
import { checkRules } from '../rules';
import { normalizeTitle, stopRef } from '../rules/rule.types';
import type { RuleInput, Violation } from '../rules';
import type { DraftStop, TripDraft } from '../trip-draft';
import { extractJson } from './planner.schema';
import { preferencePrompt } from './critic.prompts';

// Ausgabegrenze der Vorlieben-Prüfung. Großzügig wie beim Planer, weil
// Reasoning-Modelle ihr Nachdenken mitzählen; die Antwort selbst ist kurz.
export const PREFERENCE_MAX_TOKENS = 1024;
const MAX_PREFERENCE_ISSUES = 3;
const MAX_MESSAGE_CHARS = 150;
const MAX_DESCRIPTION_CHARS = 80;

// CRITIC_PREFERENCE_CHECK=off schaltet den KI-Aufruf ab (z. B. wenn das
// Groq-Kontingent knapp ist); die Regeln in Code laufen weiter.
export function preferenceCheckEnabled(): boolean {
  return process.env.CRITIC_PREFERENCE_CHECK !== 'off';
}

// Höchstens so viele Nachbesserungen pro Lauf. Danach wird der Plan mit
// offenen Befunden fertig, die Antwort nennt sie ("1 Warnung offen").
export const MAX_REPAIRS = 2;

export interface CritiqueInput extends RuleInput {
  // 0 = erster Entwurf, n = nach der n-ten Nachbesserung
  round: number;
  // Entwurf vor der letzten Nachbesserung, für den Diff pro Tag
  previous?: TripDraft;
  // Befunde der Vorlieben-Prüfung aus der Runde davor. Fehlt es, ist es die
  // erste Prüfung und die KI prüft die Vorlieben.
  preferenceIssues?: Violation[];
}

export interface Critique {
  violations: Violation[];
  // Die Tage mit Fehlern: Nur diese bessert der Planer nach. Leer heißt:
  // Der Plan ist fertig (Warnungen bleiben als Hinweis).
  repairDays: number[];
  // Befunde der Vorlieben-Prüfung, für die nächste Runde
  preferenceIssues: Violation[];
}

// Der Kritiker prüft jeden Entwurf, bevor er an den Nutzer geht:
//
//   harte Regeln (orchestrator/rules)  Code, jede Runde, 0 Tokens
//   Vorlieben ("vegetarisch", "mit Kind")  1 KI-Aufruf, nur in der ersten
//       Runde und nur, wenn der Nutzer Vorlieben genannt hat
//
// Ob ein Vorlieben-Befund nach einer Nachbesserung behoben ist, prüft
// danach wieder Code: Er ist offen, solange der beanstandete Punkt noch an
// seinem Tag steht. So kostet eine Nachbesserungsrunde keinen weiteren
// Prüfaufruf, und die KI kann nicht in jeder Runde etwas Neues finden.
export class CriticAgent implements Agent<CritiqueInput, Critique> {
  readonly name = 'critic' as const;
  private readonly logger = new Logger(CriticAgent.name);

  run(input: CritiqueInput, ctx: AgentContext): Promise<Critique> {
    return agentStep(ctx, this.name, 'critique', async (stepId) => {
      const preferenceIssues =
        input.preferenceIssues !== undefined
          ? stillOpen(input.preferenceIssues, input.draft)
          : await this.checkPreferences(input, ctx, stepId);
      const violations = sortViolations([
        ...checkRules(input),
        ...preferenceIssues,
      ]);
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
      return {
        value: { violations, repairDays, preferenceIssues },
        summary: critiqueSummary(violations, repairDays),
      };
    });
  }

  // Ein KI-Aufruf gegen die Vorlieben. Jede Meldung muss auf einen
  // Programmpunkt zeigen, den es an diesem Tag wirklich gibt; alles andere
  // wird verworfen. Schlägt der Aufruf fehl, gilt der Plan ohne diese
  // Prüfung: Die harten Regeln haben ihn schon geprüft.
  private async checkPreferences(
    input: CritiqueInput,
    ctx: AgentContext,
    stepId: string,
  ): Promise<Violation[]> {
    const { brief, draft } = input;
    if (brief.preferences.length === 0 || !preferenceCheckEnabled()) return [];
    ctx.signal.throwIfAborted();
    try {
      const result = await observedLlmCall(
        ctx.llm(this.name),
        [
          { role: 'system', content: preferencePrompt() },
          { role: 'user', content: preferenceFacts(brief.preferences, draft) },
        ],
        [],
        PREFERENCE_MAX_TOKENS,
        ctx.emit,
        { agent: this.name, parentStepId: stepId },
      );
      return parsePreferenceIssues(result.content, draft);
    } catch (error) {
      if (ctx.signal.aborted) throw error;
      this.logger.warn(`Vorlieben-Prüfung übersprungen: ${error}`);
      return [];
    }
  }
}

// Fehler zuerst, dann nach Tag (wie checkRules, jetzt mit den Vorlieben)
function sortViolations(violations: Violation[]): Violation[] {
  const rank = { error: 0, warning: 1 };
  return [...violations].sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      (a.dayNumber ?? 0) - (b.dayNumber ?? 0),
  );
}

// Programm pro Tag, knapp: Titel, Kategorie, gekürzte Beschreibung
export function preferenceFacts(
  preferences: string[],
  draft: TripDraft,
): string {
  const days: Record<string, object[]> = {};
  for (const stop of draft.stops) {
    if (stop.category === 'TRANSPORT') continue;
    (days[stop.dayNumber] ??= []).push({
      title: stop.title,
      category: stop.category,
      ...(stop.description && {
        description: stop.description.slice(0, MAX_DESCRIPTION_CHARS),
      }),
    });
  }
  return JSON.stringify({ Vorlieben: preferences, Tage: days });
}

// Prüft die Antwort der KI: nur Punkte, die es am genannten Tag gibt,
// höchstens drei, Meldung als eine Zeile Klartext.
export function parsePreferenceIssues(
  content: string | null,
  draft: TripDraft,
): Violation[] {
  let raw: unknown;
  try {
    raw = extractJson(content);
  } catch {
    return [];
  }
  const issues = (raw as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return [];
  const seen = new Set<DraftStop>();
  return issues
    .flatMap((issue: Record<string, unknown>) => {
      const stop = draft.stops.find(
        (candidate) =>
          candidate.dayNumber === issue?.dayNumber &&
          typeof issue?.stopTitle === 'string' &&
          sameTitle(candidate.title, issue.stopTitle),
      );
      const message =
        typeof issue?.message === 'string' ? cleanLine(issue.message) : '';
      if (!stop || message === '' || seen.has(stop)) return [];
      seen.add(stop);
      return [
        {
          ruleId: 'preference',
          severity: 'error' as const,
          ...stopRef(stop),
          message: `${stop.title}: ${message}`,
        },
      ];
    })
    .slice(0, MAX_PREFERENCE_ISSUES);
}

// Offen bleibt ein Befund, solange sein Programmpunkt noch an seinem Tag
// steht
function stillOpen(issues: Violation[], draft: TripDraft): Violation[] {
  return issues.filter((issue) =>
    draft.stops.some(
      (stop) =>
        stop.dayNumber === issue.dayNumber &&
        issue.stopTitle !== undefined &&
        sameTitle(stop.title, issue.stopTitle),
    ),
  );
}

function sameTitle(a: string, b: string): boolean {
  return normalizeTitle(a) === normalizeTitle(b);
}

function cleanLine(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/[*_`#<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MESSAGE_CHARS);
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

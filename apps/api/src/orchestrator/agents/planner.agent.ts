import type {
  LlmChatResult,
  LlmMessage,
} from '../../llm/llm-provider.interface';
import { itineraryValidationErrors } from '../../itinerary.dto';
import type { ItineraryDraft } from '../../runs/run-events';
import { observedLlmCall } from '../../runs/step-events';
import type { GlobeFocus } from '../../tools';
import { routeFromStops } from '../../tools/save-itinerary.tool';
import { agentStep } from '../agent.types';
import type { AgentContext } from '../agent.types';
import {
  parseTripBrief,
  tripDays,
  tripDraftErrors,
  tripNights,
} from '../trip-draft';
import type {
  DraftStop,
  PlanTask,
  ResearchFindings,
  TaskPlan,
  TripBrief,
  TripDraft,
} from '../trip-draft';
import type { BudgetReport } from './budget.agent';
import { formatEur } from './budget.agent';
import {
  REPAIR_INSTRUCTION,
  composePrompt,
  finalPrompt,
  triagePrompt,
} from './planner.prompts';
import {
  PlannerOutputError,
  parseComposeOutput,
  parseTriageOutput,
} from './planner.schema';

// Obergrenzen der Ausgabe pro Schritt. Großzügig, weil Reasoning-Modelle
// (gpt-oss) ihr Nachdenken mit in die Ausgabe zählen; abgerechnet und vom
// Groq-Limit abgezogen wird nur, was tatsächlich erzeugt wird.
export const TRIAGE_MAX_TOKENS = 1024;
export const COMPOSE_MAX_TOKENS = 3072;
export const FINAL_MAX_TOKENS = 2048;
// Nur die letzten Nachrichten des Dialogs gehen in die triage: genug für
// "Ich will verreisen" → Rückfrage → "Lissabon, 3 Tage im Oktober".
const TRIAGE_HISTORY_MESSAGES = 6;

const FALLBACK_QUESTION =
  'Gern plane ich deine Reise! Wohin soll es gehen, und wann und wie lange möchtest du reisen? Wenn du magst, nenn mir auch deinen Abreiseort und dein Budget.';

export type TriageResult =
  { kind: 'ask'; question: string } | { kind: 'ready'; brief: TripBrief };

export interface FinalizeInput {
  brief: TripBrief;
  draft: TripDraft;
  findings: ResearchFindings;
  budget: BudgetReport;
}

export interface FinalizeResult {
  reply: string;
  // Geprüfter Entwurf im Format von POST /itineraries (itinerary.draft)
  itinerary: ItineraryDraft;
  // Stationen des Entwurfs für stops.updated
  route?: GlobeFocus[];
}

// Der Planer ist der einzige Agent mit LLM in Phase 3a, und er hat vier
// Einstiege statt eines run(): triage und plan vor der Recherche, compose
// danach, finalize am Ende. Pro Lauf höchstens 4 LLM-Aufrufe: triage,
// compose (+ 1 Reparaturversuch), final. Die Rückfrage endet nach 1 Aufruf.
export class PlannerAgent {
  readonly name = 'planner' as const;

  // Keine Tools: Der Planer recherchiert nicht und speichert nicht. Den
  // Entwurf speichert der Nutzer selbst ("Plan speichern" im Frontend).

  triage(
    input: { message: string; history: LlmMessage[] },
    ctx: AgentContext,
  ): Promise<TriageResult> {
    return agentStep<TriageResult>(ctx, this.name, 'triage', async (stepId) => {
      const dialog = input.history
        .filter(
          (message) =>
            (message.role === 'user' || message.role === 'assistant') &&
            message.content &&
            !message.toolCalls?.length,
        )
        .slice(-TRIAGE_HISTORY_MESSAGES)
        .map(({ role, content }) => ({ role, content }));
      const result = await this.callLlm(
        ctx,
        stepId,
        [
          { role: 'system', content: triagePrompt(ctx.today) },
          ...dialog,
          { role: 'user', content: input.message },
        ],
        TRIAGE_MAX_TOKENS,
      );

      let output: ReturnType<typeof parseTriageOutput>;
      try {
        output = parseTriageOutput(result.content);
      } catch {
        // Kaputtes JSON: lieber einmal nachfragen als raten
        output = { status: 'ask' };
      }
      if (output.status === 'ready') {
        const parsed = parseTripBrief(output.brief, ctx.today);
        if ('brief' in parsed) {
          return {
            value: { kind: 'ready', brief: parsed.brief },
            summary: `${tripDays(parsed.brief)} Tage, ${parsed.brief.travelers} ${parsed.brief.travelers === 1 ? 'Person' : 'Personen'}`,
          };
        }
        return {
          value: { kind: 'ask', question: questionFor(parsed.errors) },
          summary: 'Rückfrage nötig',
        };
      }
      return {
        value: { kind: 'ask', question: output.question ?? FALLBACK_QUESTION },
        summary: 'Rückfrage nötig',
      };
    });
  }

  // Der Plan entsteht in Code aus dem Brief, ohne Tokens: Welche Recherche
  // nötig ist, folgt direkt aus den Eckdaten.
  plan(brief: TripBrief, ctx: AgentContext): Promise<TaskPlan> {
    return agentStep(ctx, this.name, 'plan', () => {
      const plan = buildTaskPlan(brief);
      const research = plan.tasks.filter((task) => task.agent === 'research');
      return Promise.resolve({
        value: plan,
        summary: `${research.length} Recherche-Aufgaben`,
      });
    });
  }

  compose(
    input: { brief: TripBrief; findings: ResearchFindings },
    ctx: AgentContext,
  ): Promise<TripDraft> {
    return agentStep(ctx, this.name, 'compose', async (stepId) => {
      const { brief, findings } = input;
      const messages: LlmMessage[] = [
        { role: 'system', content: composePrompt(tripDays(brief)) },
        { role: 'user', content: composeFacts(brief, findings) },
      ];
      let result = await this.callLlm(
        ctx,
        stepId,
        messages,
        COMPOSE_MAX_TOKENS,
      );
      let checked = checkDraft(result.content, brief, findings);
      if ('errors' in checked) {
        // Genau ein Reparaturversuch: Fehler zurück ans Modell
        messages.push(
          { role: 'assistant', content: result.content ?? '' },
          {
            role: 'user',
            content: `${REPAIR_INSTRUCTION}${checked.errors.slice(0, 10).join('; ')}. Antworte nur mit dem korrigierten, vollständigen JSON-Objekt.`,
          },
        );
        result = await this.callLlm(ctx, stepId, messages, COMPOSE_MAX_TOKENS);
        checked = checkDraft(result.content, brief, findings);
        if ('errors' in checked) {
          throw new PlannerOutputError(
            'Der Planer hat auch nach einem Reparaturversuch keinen gültigen Plan geliefert',
            checked.errors,
          );
        }
      }
      const { draft } = checked;
      return {
        value: draft,
        summary: `${draft.stops.length} Programmpunkte an ${tripDays(brief)} Tagen`,
      };
    });
  }

  finalize(input: FinalizeInput, ctx: AgentContext): Promise<FinalizeResult> {
    return agentStep(ctx, this.name, 'final', async (stepId) => {
      const itinerary = itineraryDraft(input);
      // Dieselbe Prüfung wie beim Speichern: Was als Entwurf rausgeht, muss
      // POST /itineraries ohne Änderung annehmen
      const errors = itineraryValidationErrors(itinerary);
      if (errors.length > 0) {
        throw new PlannerOutputError(
          'Der Entwurf ließe sich nicht speichern',
          errors,
        );
      }

      const result = await this.callLlm(
        ctx,
        stepId,
        [
          { role: 'system', content: finalPrompt() },
          { role: 'user', content: finalFacts(input) },
        ],
        FINAL_MAX_TOKENS,
      );
      ctx.emit('itinerary.draft', {
        itinerary,
        assumptions: [...input.brief.assumptions],
      });
      const route = routeFromStops(itinerary.stops);
      return {
        value: {
          reply: result.content?.trim() || 'Dein Reiseplan ist fertig.',
          itinerary,
          ...(route.length > 0 && { route }),
        },
        summary: `Antwort geschrieben, Entwurf mit ${itinerary.stops.length} Programmpunkten`,
      };
    });
  }

  private callLlm(
    ctx: AgentContext,
    stepId: string,
    messages: LlmMessage[],
    maxTokens: number,
  ): Promise<LlmChatResult> {
    ctx.signal.throwIfAborted();
    return observedLlmCall(
      ctx.llm(this.name),
      messages,
      [],
      maxTokens,
      ctx.emit,
      { agent: this.name, parentStepId: stepId },
    );
  }
}

// Der Aufgaben-Graph eines Laufs: Recherche parallel nach dem Plan, dann
// compose, budget, final. Aufgaben ohne Grundlage (Anreise ohne
// Abreiseort, Unterkunft bei Tagesausflug) entstehen gar nicht erst.
export function buildTaskPlan(brief: TripBrief): TaskPlan {
  const research: PlanTask['type'][] = [
    'research:weather',
    ...(tripNights(brief) > 0 ? (['research:lodging'] as const) : []),
    ...(brief.origin ? (['research:transport'] as const) : []),
    'research:knowledge',
    ...(brief.budget && brief.budget.currency !== 'EUR'
      ? (['research:currency'] as const)
      : []),
  ];
  const task = (
    type: PlanTask['type'],
    agent: PlanTask['agent'],
    dependsOn: string[],
  ): PlanTask => ({ id: type, type, agent, dependsOn, status: 'pending' });
  return {
    tasks: [
      ...research.map((type) => task(type, 'research', [])),
      task('compose', 'planner', research),
      task('budget', 'budget', ['compose']),
      task('final', 'planner', ['budget']),
    ],
  };
}

// Der Entwurf in genau der Form von CreateItineraryDto. Budget ist das
// genannte oder die geschätzte Summe des Budget-Agenten.
export function itineraryDraft(input: FinalizeInput): ItineraryDraft {
  const { draft, budget } = input;
  return {
    destination: draft.destination,
    startDate: draft.startDate,
    endDate: draft.endDate,
    budgetCents: budget.limitCents ?? budget.totalCents,
    currency: draft.currency,
    preferences: [...(draft.preferences ?? [])],
    stops: draft.stops.map((stop) => ({
      dayNumber: stop.dayNumber,
      order: stop.order,
      title: stop.title,
      ...(stop.description !== undefined && { description: stop.description }),
      ...(stop.category !== undefined && { category: stop.category }),
      ...(stop.costCents !== undefined && { costCents: stop.costCents }),
      ...(stop.lat !== undefined && { lat: stop.lat }),
      ...(stop.lng !== undefined && { lng: stop.lng }),
    })),
  };
}

function questionFor(errors: string[]): string {
  if (errors.some((error) => error.startsWith('Reise länger'))) {
    return 'So lange Reisen plane ich am Stück höchstens 14 Tage. Magst du die Reise kürzen oder in Abschnitte teilen?';
  }
  if (errors.some((error) => error.includes('Vergangenheit'))) {
    return 'Der Zeitraum liegt in der Vergangenheit. Wann möchtest du reisen?';
  }
  return FALLBACK_QUESTION;
}

// Prüft die compose-Antwort und baut den Entwurf. Fehlende Koordinaten
// ergänzt der Code mit denen des Ziels statt einen Reparaturversuch zu
// verbrauchen; alles andere geht als Fehlerliste zurück.
function checkDraft(
  content: string | null,
  brief: TripBrief,
  findings: ResearchFindings,
): { draft: TripDraft } | { errors: string[] } {
  let stops: DraftStop[];
  try {
    stops = parseComposeOutput(content);
  } catch (error) {
    return { errors: [`Kein gültiges JSON: ${(error as Error).message}`] };
  }
  const center = findings.destination;
  if (center) {
    stops = stops.map((stop) =>
      stop.lat === undefined || stop.lng === undefined
        ? { ...stop, lat: center.lat, lng: center.lng }
        : stop,
    );
  }
  const draft: TripDraft = {
    destination: brief.destination,
    startDate: brief.startDate,
    endDate: brief.endDate,
    budgetCents:
      brief.budget?.currency === 'EUR'
        ? Math.round(brief.budget.amount * 100)
        : (findings.budgetEurCents ?? 0),
    currency: 'EUR',
    preferences: brief.preferences,
    stops,
  };
  const errors = tripDraftErrors(draft);
  return errors.length > 0 ? { errors } : { draft };
}

// Nur Kennzahlen an das Modell (Plan 6.1, Punkt 4): Wetter pro Tag,
// die drei ersten Unterkünfte, die empfohlene Anreise, gekürzte Treffer.
export function composeFacts(
  brief: TripBrief,
  findings: ResearchFindings,
): string {
  return JSON.stringify({
    Reise: {
      destination: brief.destination,
      origin: brief.origin ?? null,
      startDate: brief.startDate,
      endDate: brief.endDate,
      days: tripDays(brief),
      travelers: brief.travelers,
      budget: brief.budget ?? null,
      preferences: brief.preferences,
      assumptions: brief.assumptions,
      center: findings.destination ?? null,
    },
    Recherche: {
      weather: findings.weather
        ? {
            source: findings.weather.source,
            days: findings.weather.days.map(
              ({ date, tMax, precipMm, label }) => ({
                date,
                tMax,
                precipMm,
                label,
              }),
            ),
          }
        : null,
      lodging:
        findings.lodging?.items.slice(0, 3).map(({ name, lat, lng }) => ({
          name,
          lat,
          lng,
        })) ?? null,
      knowledge: findings.knowledge.map(({ title, content }) => ({
        title,
        content,
      })),
    },
  });
}

export function finalFacts(input: FinalizeInput): string {
  const { brief, draft, findings, budget } = input;
  const transport = findings.transport?.options.find(
    (option) => option.mode === findings.transport?.recommended,
  );
  return JSON.stringify({
    Reise: {
      destination: brief.destination,
      origin: brief.origin ?? null,
      startDate: brief.startDate,
      endDate: brief.endDate,
      datesAssumed: brief.datesAssumed,
      travelers: brief.travelers,
      preferences: brief.preferences,
      assumptions: brief.assumptions,
      stops: draft.stops.map(
        ({ dayNumber, title, description, costCents }) => ({
          dayNumber,
          title,
          description,
          costCents,
        }),
      ),
      budget: {
        total: formatEur(budget.totalCents),
        limit: budget.limitCents === null ? null : formatEur(budget.limitCents),
        status: budget.status,
        items: budget.items.map((item) => ({
          category: item.category,
          eur: formatEur(item.cents),
        })),
      },
    },
    Recherche: {
      weather: findings.weather
        ? {
            source: findings.weather.source,
            days: findings.weather.days.map(
              ({ date, tMin, tMax, precipMm, label }) => ({
                date,
                tMin,
                tMax,
                precipMm,
                label,
              }),
            ),
          }
        : null,
      transport: transport
        ? {
            mode: transport.mode,
            priceEur: `${transport.priceMinEur}–${transport.priceMaxEur}`,
            hours: transport.durationHours,
            perPersonOneWay: true,
          }
        : null,
      lodging: findings.lodging
        ? {
            items: findings.lodging.items.slice(0, 3).map((item) => ({
              name: item.name,
              priceEur: `${item.priceMinEur}–${item.priceMaxEur}`,
            })),
            searchLinks: findings.lodging.searchLinks,
          }
        : null,
      knowledgeSources: findings.knowledge.map(({ title, source }) => ({
        title,
        source,
      })),
    },
  });
}

import type {
  LlmChatResult,
  LlmMessage,
} from '../../llm/llm-provider.interface';
import { itineraryValidationErrors } from '../../itinerary.dto';
import type { ItineraryDraft, Violation } from '../../runs/run-events';
import { observedLlmCall } from '../../runs/step-events';
import type { GlobeFocus } from '../../tools';
import { routeFromStops } from '../../tools/save-itinerary.tool';
import { agentStep } from '../agent.types';
import type { AgentContext } from '../agent.types';
import { LODGING_LABELS, parseRevision, replaceDays } from '../draft-revision';
import type { DraftRevision } from '../draft-revision';
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
  finalRevisionPrompt,
  repairPrompt,
  revisePrompt,
  triagePrompt,
  triageRevisePrompt,
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
// Überarbeitung: nur die geänderten Tage, deshalb kleinere Grenzen
export const REVISE_MAX_TOKENS = 2048;
export const FINAL_REVISION_MAX_TOKENS = 1536;
// Nur die letzten Nachrichten des Dialogs gehen in die triage: genug für
// "Ich will verreisen" → Rückfrage → "Lissabon, 3 Tage im Oktober".
const TRIAGE_HISTORY_MESSAGES = 6;
// Frühere Antworten gehen gekürzt in die triage: Für Ziel und Zeitraum
// reicht der Anfang (Rückfragen sind kurz), und einen fertigen Plan kennt
// die triage schon als Kurzfassung des Entwurfs. Spart bei einer
// Folgenachricht ~700 Tokens für die lange Plan-Antwort.
const TRIAGE_ASSISTANT_CHARS = 300;

const FALLBACK_QUESTION =
  'Gern plane ich deine Reise! Wohin soll es gehen, und wann und wie lange möchtest du reisen? Wenn du magst, nenn mir auch deinen Abreiseort und dein Budget.';

export type TriageResult =
  | { kind: 'ask'; question: string }
  | { kind: 'ready'; brief: TripBrief }
  // Änderung am bestehenden Entwurf der Session
  | { kind: 'revise'; brief: TripBrief; revision: DraftRevision };

// Der bestehende Entwurf der Session, auf den sich eine Folgenachricht
// beziehen kann
export interface CurrentDraft {
  brief: TripBrief;
  draft: TripDraft;
}

export interface ReviseInput {
  brief: TripBrief;
  draft: TripDraft;
  findings: ResearchFindings;
  revision: DraftRevision;
  // Die Folgenachricht des Nutzers
  request: string;
}

// Nachbesserung nach dem Kritiker: die Tage mit Fehlern und die Befunde
// dazu, ohne Folgenachricht
export interface RepairInput {
  brief: TripBrief;
  draft: TripDraft;
  findings: ResearchFindings;
  days: number[];
  violations: Violation[];
}

export interface FinalizeInput {
  brief: TripBrief;
  draft: TripDraft;
  findings: ResearchFindings;
  budget: BudgetReport;
  // Fassung des Entwurfs in der Session: 1 = erster Plan
  version?: number;
  // Nur bei einer Überarbeitung
  revision?: DraftRevision;
  // Überarbeitung einer gespeicherten Reise ("Im Chat bearbeiten")
  itineraryId?: string;
  // Offene Befunde des Kritikers (Warnungen, nach der letzten Nachbesserung
  // auch Fehler): Die Antwort nennt sie, statt sie zu verschweigen
  issues?: Violation[];
}

export interface FinalizeResult {
  reply: string;
  // Geprüfter Entwurf im Format von POST /itineraries (itinerary.draft)
  itinerary: ItineraryDraft;
  // Stationen des Entwurfs für stops.updated
  route?: GlobeFocus[];
}

// Der Planer ist der einzige Agent mit LLM, und er hat sechs Einstiege
// statt eines run(): triage und plan vor der Recherche, compose bzw. revise
// danach, repair nach der Kritik, finalize am Ende. Ohne Befunde des
// Kritikers höchstens 4 LLM-Aufrufe: triage, compose oder revise (+ 1
// Reparaturversuch bei ungültigem JSON), final; jede Nachbesserung kostet
// 1 Aufruf mehr (höchstens 2). Die Rückfrage endet nach 1 Aufruf, eine
// Überarbeitung ohne Programmänderung nach 2.
export class PlannerAgent {
  readonly name = 'planner' as const;

  // Keine Tools: Der Planer recherchiert nicht und speichert nicht. Den
  // Entwurf speichert der Nutzer selbst ("Plan speichern" im Frontend).

  triage(
    input: { message: string; history: LlmMessage[]; current?: CurrentDraft },
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
        .map(({ role, content }) => ({
          role,
          content:
            role === 'assistant'
              ? (content ?? '').slice(0, TRIAGE_ASSISTANT_CHARS)
              : content,
        }));
      const system = input.current
        ? triageRevisePrompt(ctx.today, draftDigest(input.current))
        : triagePrompt(ctx.today);
      const result = await this.callLlm(
        ctx,
        stepId,
        [
          { role: 'system', content: system },
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
      if (output.status === 'revise' && input.current) {
        const parsed = parseRevision(
          output.revision,
          input.current.brief,
          ctx.today,
        );
        if ('errors' in parsed) {
          return {
            value: { kind: 'ask', question: questionFor(parsed.errors) },
            summary: 'Rückfrage nötig',
          };
        }
        // Anderes Ziel (Code) oder "alles neu" (Modell): voller Ablauf mit
        // den geänderten Eckdaten
        if (parsed.kind === 'new' || output.fresh) {
          return {
            value: { kind: 'ready', brief: parsed.brief },
            summary: `neue Reise, ${tripDays(parsed.brief)} Tage`,
          };
        }
        const { days, research } = parsed.revision;
        return {
          value: parsed,
          summary: `Überarbeitung: ${days.length > 0 ? `Tag ${days.join(', ')}` : 'nur Eckdaten'}, ${research.length} Recherche-Aufgaben`,
        };
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
      // Rückfrage, oder eine Änderung ohne bestehenden Entwurf: nachfragen
      const question = output.status === 'ask' ? output.question : undefined;
      return {
        value: { kind: 'ask', question: question ?? FALLBACK_QUESTION },
        summary: 'Rückfrage nötig',
      };
    });
  }

  // Der Plan entsteht in Code aus dem Brief, ohne Tokens: Welche Recherche
  // nötig ist, folgt direkt aus den Eckdaten.
  plan(
    brief: TripBrief,
    ctx: AgentContext,
    revision?: DraftRevision,
  ): Promise<TaskPlan> {
    return agentStep(ctx, this.name, 'plan', () => {
      const plan = revision
        ? buildRevisionPlan(brief, revision)
        : buildTaskPlan(brief);
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

  // Schreibt nur die Tage aus revision.days neu; alle anderen Programmpunkte
  // bleiben unverändert. Dieselbe Prüfung wie compose, ein Reparaturversuch.
  revise(input: ReviseInput, ctx: AgentContext): Promise<TripDraft> {
    return this.rewriteDays(
      input,
      revisePrompt(input.revision.days, tripDays(input.brief)),
      reviseFacts(input),
      'revise',
      ctx,
    );
  }

  // Bessert die Tage nach, an denen der Kritiker Fehler gefunden hat. Wie
  // revise, nur mit den Befunden statt einer Nachricht des Nutzers.
  repair(input: RepairInput, ctx: AgentContext): Promise<TripDraft> {
    const revise: ReviseInput = {
      brief: input.brief,
      draft: input.draft,
      findings: input.findings,
      revision: {
        days: input.days,
        research: [],
        recompose: false,
        summary: 'nach Kritik nachgebessert',
      },
      request: '',
    };
    return this.rewriteDays(
      revise,
      repairPrompt(input.days, tripDays(input.brief)),
      reviseFacts(revise, input.violations),
      'repair',
      ctx,
    );
  }

  private rewriteDays(
    input: ReviseInput,
    system: string,
    facts: string,
    task: 'revise' | 'repair',
    ctx: AgentContext,
  ): Promise<TripDraft> {
    return agentStep(ctx, this.name, task, async (stepId) => {
      const { revision } = input;
      const messages: LlmMessage[] = [
        { role: 'system', content: system },
        { role: 'user', content: facts },
      ];
      let result = await this.callLlm(ctx, stepId, messages, REVISE_MAX_TOKENS);
      let checked = checkRevision(result.content, input);
      if ('errors' in checked) {
        messages.push(
          { role: 'assistant', content: result.content ?? '' },
          {
            role: 'user',
            content: `${REPAIR_INSTRUCTION}${checked.errors.slice(0, 10).join('; ')}. Antworte nur mit dem korrigierten JSON-Objekt mit den Programmpunkten der Tage ${revision.days.join(', ')}.`,
          },
        );
        result = await this.callLlm(ctx, stepId, messages, REVISE_MAX_TOKENS);
        checked = checkRevision(result.content, input);
        if ('errors' in checked) {
          throw new PlannerOutputError(
            'Der Planer hat auch nach einem Reparaturversuch keine gültige Änderung geliefert',
            checked.errors,
          );
        }
      }
      const { draft } = checked;
      const changed = draft.stops.filter((stop) =>
        revision.days.includes(stop.dayNumber),
      ).length;
      return {
        value: draft,
        summary: `${revision.days.length === 1 ? 'Tag' : 'Tage'} ${revision.days.join(', ')} neu, ${changed} Programmpunkte`,
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

      // Überarbeitung einzelner Tage: kurze Antwort nur zu den Änderungen.
      // Bei geänderter Reisedauer ist der ganze Plan neu, dann die volle.
      const { revision } = input;
      const short = revision !== undefined && !revision.recompose;
      const result = await this.callLlm(
        ctx,
        stepId,
        [
          {
            role: 'system',
            content: short ? finalRevisionPrompt() : finalPrompt(),
          },
          {
            role: 'user',
            content: short ? finalRevisionFacts(input) : finalFacts(input),
          },
        ],
        short ? FINAL_REVISION_MAX_TOKENS : FINAL_MAX_TOKENS,
      );
      ctx.emit('itinerary.draft', {
        itinerary,
        assumptions: [...input.brief.assumptions],
        revision: input.version ?? 1,
        ...(revision && { change: revision.summary }),
        ...(input.itineraryId && { itineraryId: input.itineraryId }),
      });
      const route = routeFromStops(itinerary.stops);
      const text = result.content?.trim() || 'Dein Reiseplan ist fertig.';
      return {
        value: {
          // Die Änderung steht vorn, aus Code statt aus der Modellantwort
          reply: revision
            ? `**Geändert:** ${revision.summary}\n\n${text}`
            : text,
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
// compose, budget, critique, final. Nachbesserungen (repair) nach der Kritik
// hängt der Orchestrator bei Bedarf an. Aufgaben ohne Grundlage (Anreise ohne
// Abreiseort, Unterkunft bei Tagesausflug) entstehen gar nicht erst.
export function buildTaskPlan(brief: TripBrief): TaskPlan {
  const research: PlanTask['type'][] = [
    'research:weather',
    ...(tripNights(brief) > 0 ? (['research:lodging'] as const) : []),
    ...(brief.origin ? (['research:transport'] as const) : []),
    'research:knowledge',
    'research:holidays',
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
      task('critique', 'critic', ['budget']),
      task('final', 'planner', ['critique']),
    ],
  };
}

// Aufgaben einer Überarbeitung: nur die Recherche, die die Änderung
// braucht, dann revise (nur betroffene Tage) oder compose (Dauer geändert),
// budget, critique und final. Ohne betroffene Tage schreibt niemand den Plan neu.
export function buildRevisionPlan(
  brief: TripBrief,
  revision: DraftRevision,
): TaskPlan {
  const task = (
    type: PlanTask['type'],
    agent: PlanTask['agent'],
    dependsOn: string[],
  ): PlanTask => ({ id: type, type, agent, dependsOn, status: 'pending' });
  const research = revision.research;
  const writer: PlanTask['type'] | undefined = revision.recompose
    ? 'compose'
    : revision.days.length > 0
      ? 'revise'
      : undefined;
  return {
    tasks: [
      ...research.map((type) => task(type, 'research', [])),
      ...(writer ? [task(writer, 'planner', research)] : []),
      task('budget', 'budget', writer ? [writer] : research),
      task('critique', 'critic', ['budget']),
      task('final', 'planner', ['critique']),
    ],
  };
}

// Der Entwurf in genau der Form von CreateItineraryDto. Budget ist das
// genannte oder die geschätzte Summe des Budget-Agenten.
export function itineraryDraft(input: FinalizeInput): ItineraryDraft {
  const { draft, budget, brief } = input;
  return {
    destination: draft.destination,
    startDate: draft.startDate,
    endDate: draft.endDate,
    budgetCents: budget.limitCents ?? budget.totalCents,
    currency: draft.currency,
    preferences: [...(draft.preferences ?? [])],
    travelers: brief.travelers,
    ...(brief.origin && { origin: brief.origin }),
    ...(brief.lodging && { lodging: brief.lodging }),
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
  const draft = draftFor(brief, findings, withCoordinates(stops, findings));
  const errors = tripDraftErrors(draft);
  return errors.length > 0 ? { errors } : { draft };
}

// Prüft die revise-Antwort: nur Punkte der freigegebenen Tage, danach
// zusammen mit den unveränderten Tagen dieselbe Prüfung wie compose.
function checkRevision(
  content: string | null,
  input: ReviseInput,
): { draft: TripDraft } | { errors: string[] } {
  const { brief, draft, findings, revision } = input;
  let stops: DraftStop[];
  try {
    stops = parseComposeOutput(content);
  } catch (error) {
    return { errors: [`Kein gültiges JSON: ${(error as Error).message}`] };
  }
  const outside = stops
    .map((stop, index) => ({ stop, index }))
    .filter(({ stop }) => !revision.days.includes(stop.dayNumber))
    .map(
      ({ stop, index }) =>
        `stops.${index}.dayNumber ${String(stop.dayNumber)} gehört nicht zu den Tagen ${revision.days.join(', ')}`,
    );
  if (outside.length > 0) return { errors: outside };
  const merged = draftFor(
    brief,
    findings,
    replaceDays(draft.stops, revision.days, withCoordinates(stops, findings)),
  );
  const errors = tripDraftErrors(merged);
  return errors.length > 0 ? { errors } : { draft: merged };
}

// Fehlende Koordinaten ergänzt der Code mit denen des Ziels, statt einen
// Reparaturversuch zu verbrauchen
export function withCoordinates(
  stops: DraftStop[],
  findings: ResearchFindings,
): DraftStop[] {
  const center = findings.destination;
  if (!center) return stops;
  return stops.map((stop) =>
    stop.lat === undefined || stop.lng === undefined
      ? { ...stop, lat: center.lat, lng: center.lng }
      : stop,
  );
}

// Entwurf aus Eckdaten und Programmpunkten. Auch für eine Überarbeitung
// ohne neues Programm: Daten, Budget und Vorlieben kommen aus dem neuen
// Brief, die Stops bleiben.
export function draftFor(
  brief: TripBrief,
  findings: ResearchFindings,
  stops: DraftStop[],
): TripDraft {
  return {
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
}

// Kurzfassung des bestehenden Entwurfs für die triage: Eckdaten und die
// Titel pro Tag, damit das Modell "Tag 2" zuordnen und eine Änderung von
// einer neuen Reise unterscheiden kann (~150 Tokens statt der ganzen
// Antwort).
export function draftDigest({ brief, draft }: CurrentDraft): string {
  const days: Record<string, string[]> = {};
  for (const stop of draft.stops) {
    (days[stop.dayNumber] ??= []).push(stop.title);
  }
  return JSON.stringify({
    destination: brief.destination,
    origin: brief.origin,
    startDate: brief.startDate,
    endDate: brief.endDate,
    travelers: brief.travelers,
    budget: brief.budget,
    preferences: brief.preferences,
    lodging: brief.lodging,
    days,
  });
}

// Fakten für revise: die betroffenen Tage vollständig, die anderen nur als
// Titel, Wetter nur für die betroffenen Tage.
// Bei einer Nachbesserung (violations) stehen die Befunde des Kritikers
// statt des Wunsches darin.
export function reviseFacts(
  input: ReviseInput,
  violations?: Violation[],
): string {
  const { brief, draft, findings, revision, request } = input;
  const affected = (day: number) => revision.days.includes(day);
  const others: Record<string, string[]> = {};
  for (const stop of draft.stops) {
    if (!affected(stop.dayNumber)) {
      (others[stop.dayNumber] ??= []).push(stop.title);
    }
  }
  const dates = new Set(
    revision.days.map((day) => addDays(brief.startDate, day - 1)),
  );
  return JSON.stringify({
    ...(violations
      ? { Kritik: violations.map((violation) => violation.message) }
      : { Wunsch: request }),
    Reise: {
      destination: brief.destination,
      startDate: brief.startDate,
      days: tripDays(brief),
      travelers: brief.travelers,
      budget: brief.budget ?? null,
      preferences: brief.preferences,
      change: revision.summary,
      center: findings.destination ?? null,
      Tage: draft.stops
        .filter((stop) => affected(stop.dayNumber))
        .map(({ dayNumber, order, title, category, costCents, lat, lng }) => ({
          dayNumber,
          order,
          title,
          category,
          costCents,
          lat,
          lng,
        })),
      AndereTage: others,
    },
    Recherche: {
      weather:
        findings.weather?.days
          .filter((day) => dates.has(day.date))
          .map(({ date, tMax, precipMm, label }) => ({
            date,
            tMax,
            precipMm,
            label,
          })) ?? null,
    },
  });
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
      lodging: brief.lodging ?? null,
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
      holidays: findings.holidays?.length ? findings.holidays : null,
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
      lodging: brief.lodging ? LODGING_LABELS[brief.lodging] : null,
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
    Hinweise: issueTexts(input.issues),
  });
}

// Offene Befunde des Kritikers für die Antwort, nur der Text
function issueTexts(issues: Violation[] | undefined): string[] {
  return (issues ?? []).map((issue) => issue.message);
}

// Fakten für die Antwort auf eine Überarbeitung: die geänderten Tage, die
// Nummern der unveränderten, das neue Budget, Unterkünfte nur, wenn sie neu
// gesucht wurden. Wetter und Wissensbasis kennt der Nutzer schon.
export function finalRevisionFacts(input: FinalizeInput): string {
  const { brief, draft, findings, budget, revision } = input;
  const days = revision?.days ?? [];
  const unchanged = Array.from(
    { length: tripDays(brief) },
    (_, i) => i + 1,
  ).filter((day) => !days.includes(day));
  const lodgingRefreshed =
    revision?.research.includes('research:lodging') ?? false;
  return JSON.stringify({
    Reise: {
      destination: brief.destination,
      startDate: brief.startDate,
      endDate: brief.endDate,
      travelers: brief.travelers,
      preferences: brief.preferences,
      lodging: brief.lodging ? LODGING_LABELS[brief.lodging] : null,
      changedDays: draft.stops
        .filter((stop) => days.includes(stop.dayNumber))
        .map(({ dayNumber, title, description, costCents }) => ({
          dayNumber,
          title,
          description,
          costCents,
        })),
      unchangedDays: unchanged,
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
      lodging:
        lodgingRefreshed && findings.lodging
          ? {
              items: findings.lodging.items.slice(0, 3).map((item) => ({
                name: item.name,
                priceEur: `${item.priceMinEur}–${item.priceMaxEur}`,
              })),
              searchLinks: findings.lodging.searchLinks,
            }
          : null,
    },
    Hinweise: issueTexts(input.issues),
  });
}

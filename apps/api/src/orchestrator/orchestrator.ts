import { Logger } from '@nestjs/common';
import { citedSources } from '../agent.service';
import type { ChatResult } from '../agent.service';
import type { ExternalCache } from '../external/external-cache';
import type { ItinerariesService } from '../itineraries.service';
import type { ConversationStore } from '../llm/conversation-store';
import type { LlmProvider } from '../llm/llm-provider.interface';
import type { AgentMode, PlanTaskInfo, TaskStatus } from '../runs/run-events';
import type { EmitRunEvent } from '../runs/step-events';
import { ToolRegistry, createToolSet } from '../tools';
import type { AgentContext } from './agent.types';
import { BudgetAgent } from './agents/budget.agent';
import type { BudgetReport } from './agents/budget.agent';
import { CriticAgent } from './agents/critic.agent';
import type { Critique } from './agents/critic.agent';
import { PlannerOutputError } from './agents/planner.schema';
import { PlannerAgent, draftFor } from './agents/planner.agent';
import type { FinalizeResult } from './agents/planner.agent';
import { ResearchAgent } from './agents/research.agent';
import { mergeFindings } from './draft-revision';
import type { DraftRevision } from './draft-revision';
import type {
  ResearchFindings,
  TaskPlan,
  TripBrief,
  TripDraft,
} from './trip-draft';
import type { StoredTripDraft, TripDraftStore } from './trip-draft-store';

// Server-Default für POST /agent/runs, wenn der Client keinen Modus wählt:
// AGENT_MODE=multi schaltet auf den Orchestrator, sonst classic.
// POST /agent/chat (Evals, MCP) nutzt immer den Classic-Agenten.
export function agentMode(): AgentMode {
  return process.env.AGENT_MODE === 'multi' ? 'multi' : 'classic';
}

// Notbremse: Mit AGENT_MODE_LOCKED=true gilt immer der Server-Default, die
// Wahl des Clients wird ignoriert (z. B. wenn der Multi-Modus live Probleme
// macht und niemand auf ein neues Frontend warten soll).
export function agentModeLocked(): boolean {
  return process.env.AGENT_MODE_LOCKED === 'true';
}

// Der Modus eines Laufs: die Wahl des Clients, außer die Notbremse greift
// oder er hat keine getroffen.
export function resolveAgentMode(requested?: AgentMode): AgentMode {
  if (agentModeLocked() || requested === undefined) return agentMode();
  return requested;
}

// Laufzeitlimit eines ganzen Laufs; geprüft zwischen den Zuständen und vor
// jedem LLM-Aufruf des Planers
export const RUN_TIMEOUT_MS = 120_000;

export type OrchestratorState =
  | 'triage'
  | 'plan'
  | 'research'
  | 'compose'
  | 'revise'
  | 'budget'
  | 'critique'
  | 'repair'
  | 'finalize'
  | 'done';

export interface OrchestratorDeps {
  conversationStore: ConversationStore;
  // Letzter Entwurf pro Session, Grundlage für Überarbeitungen
  tripDraftStore: TripDraftStore;
  llm: LlmProvider;
  planner: PlannerAgent;
  research: ResearchAgent;
  budget: BudgetAgent;
  critic: CriticAgent;
  today?: () => string;
}

export interface RunInput {
  runId: string;
  userId: string;
  sessionId: string;
  message: string;
}

// Alles, was im Lauf entsteht. Jeder Zustand füllt sein Feld und nennt den
// nächsten Zustand.
interface RunData {
  input: RunInput;
  // Gespeicherter Entwurf der Session (vor diesem Lauf), falls vorhanden
  base?: StoredTripDraft;
  // Gesetzt, wenn die triage eine Änderung an `base` erkannt hat
  revision?: DraftRevision;
  reply?: string;
  brief?: TripBrief;
  plan?: TaskPlan;
  findings?: ResearchFindings;
  draft?: TripDraft;
  budget?: BudgetReport;
  critique?: Critique;
  // Zahl der Nachbesserungen nach der Kritik in diesem Lauf
  repairs: number;
  // Entwurf vor der letzten Nachbesserung (Diff pro Tag im critique-Ereignis)
  previousDraft?: TripDraft;
  final?: FinalizeResult;
}

// Der Orchestrator als explizite State Machine (ADR 0001):
//
//   triage ─(Rückfrage)────────────────────────────────────────────────────┐
//     └→ plan → research ─┬→ compose ─┬→ budget → critique ─→ finalize → done ◄┘
//                         ├→ revise ──┤     ▲         │
//                         └───────────┘     └─ repair ◄┘ (Fehler, höchstens 2×)
//                     (nur Eckdaten geändert)
//
// Jeder Zustand ist eine Methode, die genau einen Agenten-Schritt anstößt
// und den Folgezustand zurückgibt. Bei einer Überarbeitung (Folgenachricht
// zum Entwurf der Session) läuft nur die Recherche, die die Änderung
// braucht (oft keine), revise schreibt nur die betroffenen Tage neu; ohne
// betroffene Tage geht es direkt zu budget. Danach prüft der Kritiker den
// Entwurf mit festen Regeln (orchestrator/rules); findet er Fehler, bessert
// der Planer nur die betroffenen Tage nach (repair), Budget und Kritik laufen
// erneut. Nach höchstens MAX_REPAIRS Runden geht der Plan mit offenen
// Befunden raus, die Antwort nennt sie.
export class Orchestrator {
  private readonly logger = new Logger(Orchestrator.name);

  constructor(private readonly deps: OrchestratorDeps) {}

  async run(
    input: RunInput,
    emit: EmitRunEvent,
    signal: AbortSignal = AbortSignal.timeout(RUN_TIMEOUT_MS),
  ): Promise<ChatResult> {
    const ctx: AgentContext = {
      runId: input.runId,
      userId: input.userId,
      emit,
      // Phase 3a: ein Provider für alle Agenten (AGENT_MODEL_* folgt in 3b)
      llm: () => this.deps.llm,
      signal,
      today: this.deps.today?.() ?? new Date().toISOString().slice(0, 10),
    };
    const [history, base] = await Promise.all([
      this.deps.conversationStore.load(input.userId, input.sessionId),
      this.deps.tripDraftStore.load(input.userId, input.sessionId),
    ]);
    const data: RunData = { input, repairs: 0, ...(base && { base }) };
    const board = new TaskBoard(emit);

    let state: OrchestratorState = 'triage';
    while (state !== 'done') {
      signal.throwIfAborted();
      this.logger.debug(`Lauf ${input.runId}: ${state}`);
      state = await this.step(state, data, ctx, board, history);
    }

    const reply = data.reply ?? '';
    // Verlauf wie im Classic-Modus, damit Folgenachrichten (auch nach einem
    // Wechsel des Modus) den Dialog kennen. Nur Text, keine Zwischenschritte.
    history.push(
      { role: 'user', content: input.message },
      { role: 'assistant', content: reply },
    );
    await this.deps.conversationStore.save(
      input.userId,
      input.sessionId,
      history,
    );
    // Der neue Entwurf ersetzt den alten, auch bei einer neuen Reise. Nach
    // einer Rückfrage bleibt der alte stehen.
    if (data.final && data.brief && data.draft && data.findings) {
      await this.deps.tripDraftStore.save(input.userId, input.sessionId, {
        revision: version(data),
        brief: data.brief,
        draft: data.draft,
        findings: data.findings,
        ...(data.budget && { budget: data.budget }),
      });
    }

    const findings = data.findings;
    return {
      reply,
      sources: findings
        ? citedSources(
            [...findings.sources].sort((a, b) => b.score - a.score),
            reply,
          )
        : [],
      searchAttempted: findings?.searchAttempted ?? false,
      focus: findings?.destination,
      route: data.final?.route,
    };
  }

  private async step(
    state: OrchestratorState,
    data: RunData,
    ctx: AgentContext,
    board: TaskBoard,
    history: Parameters<PlannerAgent['triage']>[0]['history'],
  ): Promise<OrchestratorState> {
    const { planner, research, budget, critic } = this.deps;
    switch (state) {
      case 'triage': {
        const result = await planner.triage(
          {
            message: data.input.message,
            history,
            ...(data.base && {
              current: { brief: data.base.brief, draft: data.base.draft },
            }),
          },
          ctx,
        );
        if (result.kind === 'ask') {
          data.reply = result.question;
          return 'done';
        }
        data.brief = result.brief;
        if (result.kind === 'revise') data.revision = result.revision;
        return 'plan';
      }
      case 'plan': {
        data.plan = await planner.plan(data.brief!, ctx, data.revision);
        board.load(data.plan);
        return 'research';
      }
      case 'research': {
        const tasks = data.plan!.tasks.filter(
          (task) => task.agent === 'research',
        );
        // Überarbeitung ohne neue Recherche: die gespeicherte gilt weiter
        const fresh =
          tasks.length > 0
            ? await research.run(
                {
                  brief: data.brief!,
                  tasks,
                  onTaskStatus: (id, status) => board.set(id, status),
                },
                ctx,
              )
            : undefined;
        const { revision, base } = data;
        if (!revision || !base) {
          data.findings = fresh;
          return 'compose';
        }
        data.findings = fresh
          ? mergeFindings(
              base.findings,
              fresh,
              tasks.map((task) => task.type),
            )
          : base.findings;
        if (revision.recompose) return 'compose';
        if (revision.days.length > 0) return 'revise';
        // Nur Eckdaten geändert (Unterkunft, Budget, Personen): Programm
        // bleibt, Daten und Budget des Entwurfs kommen aus dem neuen Brief
        data.draft = draftFor(data.brief!, data.findings, base.draft.stops);
        return 'budget';
      }
      case 'revise': {
        data.draft = await board.track('revise', () =>
          planner.revise(
            {
              brief: data.brief!,
              draft: data.base!.draft,
              findings: data.findings!,
              revision: data.revision!,
              request: data.input.message,
            },
            ctx,
          ),
        );
        return 'budget';
      }
      case 'compose': {
        data.draft = await board.track('compose', () =>
          planner.compose(
            { brief: data.brief!, findings: data.findings! },
            ctx,
          ),
        );
        return 'budget';
      }
      case 'budget': {
        data.budget = await board.track('budget', () =>
          budget.run(
            {
              brief: data.brief!,
              draft: data.draft!,
              findings: data.findings!,
            },
            ctx,
          ),
        );
        return 'critique';
      }
      case 'critique': {
        data.critique = await board.track('critique', () =>
          critic.run(
            {
              brief: data.brief!,
              draft: data.draft!,
              findings: data.findings!,
              budget: data.budget!,
              round: data.repairs,
              ...(data.previousDraft && { previous: data.previousDraft }),
              ...(data.critique && {
                preferenceIssues: data.critique.preferenceIssues,
              }),
            },
            ctx,
          ),
        );
        return data.critique.repairDays.length > 0 ? 'repair' : 'finalize';
      }
      case 'repair': {
        const { repairDays, violations } = data.critique!;
        data.repairs += 1;
        const id = `repair-${data.repairs}`;
        board.add({
          id,
          type: 'repair',
          agent: 'planner',
          dependsOn: ['critique'],
          status: 'pending',
        });
        try {
          const repaired = await board.track(id, () =>
            planner.repair(
              {
                brief: data.brief!,
                draft: data.draft!,
                findings: data.findings!,
                days: repairDays,
                violations: violations.filter(
                  (v) =>
                    v.dayNumber !== undefined &&
                    repairDays.includes(v.dayNumber),
                ),
              },
              ctx,
            ),
          );
          data.previousDraft = data.draft;
          data.draft = repaired;
        } catch (error) {
          // Eine gescheiterte Nachbesserung kostet nicht den ganzen Plan:
          // Der geprüfte Entwurf bleibt, die Befunde nennt die Antwort
          if (!(error instanceof PlannerOutputError)) throw error;
          this.logger.warn(
            `Lauf ${data.input.runId}: Nachbesserung gescheitert, Entwurf bleibt`,
          );
          return 'finalize';
        }
        return 'budget';
      }
      case 'finalize': {
        // Speichert nicht: Der Plan geht als itinerary.draft ans Frontend,
        // gespeichert wird erst per "Plan speichern" (POST /itineraries)
        data.final = await board.track('final', () =>
          planner.finalize(
            {
              brief: data.brief!,
              draft: data.draft!,
              findings: data.findings!,
              budget: data.budget!,
              version: version(data),
              ...(data.revision && { revision: data.revision }),
              issues: data.critique?.violations ?? [],
            },
            ctx,
          ),
        );
        data.reply = data.final.reply;
        return 'done';
      }
      default:
        return 'done';
    }
  }
}

// Fassung des Entwurfs in der Session: Eine Überarbeitung zählt weiter,
// eine neue Reise beginnt wieder bei 1
function version(data: RunData): number {
  return data.revision && data.base ? data.base.revision + 1 : 1;
}

// Hält den Stand der Aufgaben und meldet jede Änderung als plan.updated
// (vollständige Liste, damit das Frontend keinen Zustand zusammensetzen muss).
class TaskBoard {
  private plan?: TaskPlan;

  constructor(private readonly emit: EmitRunEvent) {}

  load(plan: TaskPlan): void {
    this.plan = plan;
    this.publish();
  }

  // Neue Aufgabe vor der letzten (final), z. B. eine Nachbesserung
  add(task: PlanTaskInfo): void {
    if (!this.plan) return;
    const tasks = this.plan.tasks;
    tasks.splice(Math.max(0, tasks.length - 1), 0, { ...task });
    this.publish();
  }

  set(id: string, status: TaskStatus): void {
    const task = this.plan?.tasks.find((entry) => entry.id === id);
    if (!task || task.status === status) return;
    task.status = status;
    this.publish();
  }

  async track<T>(id: string, fn: () => Promise<T>): Promise<T> {
    this.set(id, 'running');
    try {
      const value = await fn();
      this.set(id, 'done');
      return value;
    } catch (error) {
      this.set(id, 'error');
      throw error;
    }
  }

  private publish(): void {
    if (!this.plan) return;
    this.emit('plan.updated', {
      tasks: this.plan.tasks.map((task) => ({
        ...task,
        dependsOn: [...task.dependsOn],
      })),
    });
  }
}

// Baut den Orchestrator mit eigenen ToolRegistry-Instanzen pro Agent aus
// denselben Tool-Objekten wie der Classic-Agent (tools/index.ts).
export function createOrchestrator(
  itinerariesService: ItinerariesService,
  llm: LlmProvider,
  conversationStore: ConversationStore,
  externalCache: ExternalCache,
  tripDraftStore: TripDraftStore,
): Orchestrator {
  const tools = createToolSet(itinerariesService, externalCache);
  return new Orchestrator({
    conversationStore,
    tripDraftStore,
    llm,
    planner: new PlannerAgent(),
    research: new ResearchAgent(
      new ToolRegistry([
        tools.weather,
        tools.lodging,
        tools.transport,
        tools.knowledge,
        tools.currency,
        tools.holidays,
      ]),
    ),
    budget: new BudgetAgent(),
    critic: new CriticAgent(),
  });
}

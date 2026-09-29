import { Logger } from '@nestjs/common';
import { citedSources } from '../agent.service';
import type { ChatResult } from '../agent.service';
import type { ExternalCache } from '../external/external-cache';
import type { ItinerariesService } from '../itineraries.service';
import type { ConversationStore } from '../llm/conversation-store';
import type { LlmProvider } from '../llm/llm-provider.interface';
import type { AgentMode, TaskStatus } from '../runs/run-events';
import type { EmitRunEvent } from '../runs/step-events';
import { ToolRegistry, createToolSet } from '../tools';
import type { AgentContext } from './agent.types';
import { BudgetAgent } from './agents/budget.agent';
import type { BudgetReport } from './agents/budget.agent';
import { PlannerAgent } from './agents/planner.agent';
import type { FinalizeResult } from './agents/planner.agent';
import { ResearchAgent } from './agents/research.agent';
import type {
  ResearchFindings,
  TaskPlan,
  TripBrief,
  TripDraft,
} from './trip-draft';

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
  'triage' | 'plan' | 'research' | 'compose' | 'budget' | 'finalize' | 'done';

export interface OrchestratorDeps {
  conversationStore: ConversationStore;
  llm: LlmProvider;
  planner: PlannerAgent;
  research: ResearchAgent;
  budget: BudgetAgent;
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
  reply?: string;
  brief?: TripBrief;
  plan?: TaskPlan;
  findings?: ResearchFindings;
  draft?: TripDraft;
  budget?: BudgetReport;
  final?: FinalizeResult;
}

// Der Orchestrator als explizite State Machine (ADR 0001):
//
//   triage ─(Rückfrage)────────────────────────────────────────┐
//     └→ plan → research → compose → budget → finalize → done ◄┘
//
// Jeder Zustand ist eine Methode, die genau einen Agenten-Schritt anstößt
// und den Folgezustand zurückgibt. Die Kritik (critique/revise) kommt in
// Phase 4 zwischen budget und finalize dazu.
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
    const history = await this.deps.conversationStore.load(
      input.userId,
      input.sessionId,
    );
    const data: RunData = { input };
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
    const { planner, research, budget } = this.deps;
    switch (state) {
      case 'triage': {
        const result = await planner.triage(
          { message: data.input.message, history },
          ctx,
        );
        if (result.kind === 'ask') {
          data.reply = result.question;
          return 'done';
        }
        data.brief = result.brief;
        return 'plan';
      }
      case 'plan': {
        data.plan = await planner.plan(data.brief!, ctx);
        board.load(data.plan);
        return 'research';
      }
      case 'research': {
        data.findings = await research.run(
          {
            brief: data.brief!,
            tasks: data.plan!.tasks.filter((task) => task.agent === 'research'),
            onTaskStatus: (id, status) => board.set(id, status),
          },
          ctx,
        );
        return 'compose';
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
        return 'finalize';
      }
      case 'finalize': {
        data.final = await board.track('final', () =>
          planner.finalize(
            {
              brief: data.brief!,
              draft: data.draft!,
              findings: data.findings!,
              budget: data.budget!,
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

// Hält den Stand der Aufgaben und meldet jede Änderung als plan.updated
// (vollständige Liste, damit das Frontend keinen Zustand zusammensetzen muss).
class TaskBoard {
  private plan?: TaskPlan;

  constructor(private readonly emit: EmitRunEvent) {}

  load(plan: TaskPlan): void {
    this.plan = plan;
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
): Orchestrator {
  const tools = createToolSet(itinerariesService, externalCache);
  return new Orchestrator({
    conversationStore,
    llm,
    planner: new PlannerAgent(new ToolRegistry([tools.saveItinerary])),
    research: new ResearchAgent(
      new ToolRegistry([
        tools.weather,
        tools.lodging,
        tools.transport,
        tools.knowledge,
        tools.currency,
      ]),
    ),
    budget: new BudgetAgent(),
  });
}

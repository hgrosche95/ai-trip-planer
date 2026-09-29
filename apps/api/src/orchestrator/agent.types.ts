import { randomUUID } from 'node:crypto';
import type { LlmProvider } from '../llm/llm-provider.interface';
import type { AgentName, TaskType } from '../runs/run-events';
import type { EmitRunEvent } from '../runs/step-events';

export type { AgentName, TaskType } from '../runs/run-events';

// Was jeder Agent während eines Laufs vom Orchestrator bekommt. Die Agenten
// kennen weder Controller noch SSE: Sie melden alles über `emit`.
export interface AgentContext {
  runId: string;
  userId: string;
  // → SSE-Stream und Aufzeichnung für das Replay (RunEventEmitter)
  emit: EmitRunEvent;
  // Provider pro Agent. In Phase 3a liefert es für alle Agenten denselben
  // Provider (LLM_PROVIDER), die Modellwahl pro Agent (AGENT_MODEL_*) folgt.
  llm: (agent: AgentName) => LlmProvider;
  // Laufzeitlimit des ganzen Laufs; der Orchestrator prüft es zwischen
  // den Zuständen
  signal: AbortSignal;
  // "Heute" als YYYY-MM-DD, injizierbar für Tests
  today: string;
}

export interface Agent<I, O> {
  name: AgentName;
  run(input: I, ctx: AgentContext): Promise<O>;
}

// Ergebnis eines Agenten-Schritts für agent.finished: Status und eine kurze
// Zusammenfassung ohne Nutzerfreitext ("3 Tage, Vorhersage").
export interface StepOutcome<T> {
  value: T;
  status?: 'ok' | 'error' | 'skipped';
  summary: string;
}

// Rahmt eine Aufgabe eines Agenten mit agent.started / agent.finished ein.
// `fn` bekommt die stepId, damit LLM-Aufrufe und Tools darin als
// parentStepId auf diesen Schritt zeigen (Lane im Trace-Panel). Wirft `fn`,
// wird der Schritt als Fehler abgeschlossen und der Fehler weitergereicht.
export async function agentStep<T>(
  ctx: AgentContext,
  agent: AgentName,
  task: TaskType,
  fn: (stepId: string) => Promise<StepOutcome<T>>,
): Promise<T> {
  const stepId = randomUUID();
  ctx.emit('agent.started', { stepId, agent, task });
  const startedAt = performance.now();
  const durationMs = () => Math.round(performance.now() - startedAt);
  try {
    const outcome = await fn(stepId);
    ctx.emit('agent.finished', {
      stepId,
      agent,
      task,
      status: outcome.status ?? 'ok',
      durationMs: durationMs(),
      summary: outcome.summary,
    });
    return outcome.value;
  } catch (error) {
    ctx.emit('agent.finished', {
      stepId,
      agent,
      task,
      status: 'error',
      durationMs: durationMs(),
      summary: 'fehlgeschlagen',
    });
    throw error;
  }
}

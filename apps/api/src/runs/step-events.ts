import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { startActiveObservation } from '@langfuse/tracing';
import type {
  LlmChatResult,
  LlmMessage,
  LlmProvider,
  LlmToolDefinition,
} from '../llm/llm-provider.interface';
import { estimateCostUsd } from '../llm/pricing';
import { hasError } from '../tools';
import type { ToolRegistry, ToolRun } from '../tools';
import type { AgentName, RunEventPayloads, RunEventType } from './run-events';

// Die Messpunkte um LLM-Aufrufe und Tools, die der Classic-Agent
// (agent.service.ts) und die Agenten des Orchestrators (orchestrator/)
// gemeinsam nutzen: Langfuse-Observation wie bisher, dazu die Ereignisse für
// die Timeline. Ohne `emit` (POST /agent/chat) nur die Observation.

export type EmitRunEvent = <T extends RunEventType>(
  type: T,
  data: RunEventPayloads[T],
) => void;

// Zu welchem Agenten und welchem Agenten-Schritt ein LLM-Aufruf oder Tool
// gehört. Nur im Multi-Agenten-Modus gesetzt, Classic-Ereignisse bleiben
// unverändert.
export interface StepOrigin {
  agent: AgentName;
  parentStepId: string;
}

const logger = new Logger('LlmCall');

export async function observedLlmCall(
  llm: LlmProvider,
  messages: LlmMessage[],
  tools: LlmToolDefinition[],
  maxTokens: number,
  emit?: EmitRunEvent,
  origin?: StepOrigin,
): Promise<LlmChatResult> {
  const agent = origin && { agent: origin.agent };
  return startActiveObservation(
    'llm-call',
    async (generation) => {
      const stepId = randomUUID();
      emit?.('llm.started', { stepId, ...origin });
      const startedAt = performance.now();
      const result = await llm.chat(messages, tools, {
        maxTokens,
        // Nur Groq drosselt vorab (RateLimitedLlmProvider), die Wartezeit
        // erscheint dann an dieser Zeile der Timeline
        onThrottle: (waitMs, reason) =>
          emit?.('llm.throttled', { stepId, ...agent, waitMs, reason }),
      });
      emit?.('llm.call', {
        stepId,
        ...agent,
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        latencyMs: Math.round(performance.now() - startedAt),
        costUsd: estimateCostUsd(
          result.model,
          result.usage.inputTokens,
          result.usage.outputTokens,
        ),
        finishReason: result.finishReason,
      });
      generation.update({
        model: result.model,
        usageDetails: {
          input: result.usage.inputTokens,
          output: result.usage.outputTokens,
        },
        metadata: {
          finishReason: result.finishReason,
          ...(origin && { agent: origin.agent }),
        },
      });
      logger.log(
        `LLM-Aufruf${origin ? ` (${origin.agent})` : ''}: ${result.usage.inputTokens} Input-Tokens, ${result.usage.outputTokens} Output-Tokens`,
      );
      return result;
    },
    { asType: 'generation' },
  );
}

// Führt ein Tool aus und meldet Start und Ende als Ereignis, damit die
// Timeline jedes Tool mit seiner Laufzeit zeigt.
export async function observedToolRun(
  tools: ToolRegistry,
  name: string,
  args: unknown,
  userId: string,
  emit?: EmitRunEvent,
  origin?: StepOrigin,
): Promise<ToolRun> {
  const stepId = randomUUID();
  emit?.('tool.started', { stepId, tool: name, ...origin });
  const startedAt = performance.now();
  const run = await tools.execute(name, args, { userId });
  emit?.('tool.finished', {
    stepId,
    tool: name,
    kind: run.retrieval ? 'retriever' : 'tool',
    latencyMs: Math.round(performance.now() - startedAt),
    ok: !hasError(run.output),
    ...(run.retrieval && { hits: run.sources.length }),
    ...(run.cached !== undefined && { cached: run.cached }),
  });
  return run;
}

// Was ein Tool fürs Frontend mitbringt, geht sofort raus, nicht erst mit der
// fertigen Antwort: Marker und Bögen für den Globus, Wetter-Chips,
// Unterkünfte. Der Globus reagiert, während der Agent noch weiterarbeitet.
export function emitToolResults(run: ToolRun, emit?: EmitRunEvent): void {
  if (!emit) return;
  if (run.flight) {
    emit('place.added', { ...run.flight.from, kind: 'origin' });
    emit('route.added', run.flight);
  }
  if (run.focus) {
    emit('place.added', { ...run.focus, kind: 'destination' });
  }
  if (run.weather) emit('weather.updated', run.weather);
  if (run.lodging) emit('lodging.updated', run.lodging);
}

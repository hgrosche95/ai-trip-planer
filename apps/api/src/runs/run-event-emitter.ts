import type {
  RunEvent,
  RunEventPayloads,
  RunEventType,
  RunTotals,
} from './run-events';

export type RunEventSink = (event: RunEvent) => void;

// Nummeriert die Ereignisse eines Laufs, stempelt die Zeit seit Laufbeginn
// darauf und reicht sie an eine Senke weiter (im Controller: die SSE-Antwort,
// in Tests: ein Array). Zählt nebenbei die Summen für run.finished mit, damit
// niemand sonst Tokens und Kosten zusammenrechnen muss.
export class RunEventEmitter {
  private seq = 0;
  private readonly startedAt = performance.now();
  private readonly counts = {
    llmCalls: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  };

  constructor(private readonly sink: RunEventSink) {}

  emit<T extends RunEventType>(type: T, data: RunEventPayloads[T]): void {
    if (type === 'llm.call') {
      const call = data as RunEventPayloads['llm.call'];
      this.counts.llmCalls++;
      this.counts.inputTokens += call.inputTokens;
      this.counts.outputTokens += call.outputTokens;
      this.counts.costUsd += call.costUsd ?? 0;
    } else if (type === 'tool.finished') {
      this.counts.toolCalls++;
    }
    this.sink({
      type,
      seq: ++this.seq,
      elapsedMs: this.elapsedMs(),
      data,
    } as RunEvent);
  }

  totals(): RunTotals {
    return { ...this.counts, durationMs: this.elapsedMs() };
  }

  private elapsedMs(): number {
    return Math.round(performance.now() - this.startedAt);
  }
}

// Ein Ereignis im SSE-Format: "event:" wählt im Client den Typ, "id:" macht
// die Reihenfolge nachvollziehbar, die Leerzeile beendet das Ereignis.
export function formatSse(event: RunEvent): string {
  return `event: ${event.type}\nid: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`;
}

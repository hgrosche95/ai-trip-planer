import { RunEventEmitter, formatSse } from './run-event-emitter';
import type { RunEvent } from './run-events';

describe('RunEventEmitter', () => {
  it('nummeriert Ereignisse fortlaufend und summiert Tokens und Kosten', () => {
    const received: RunEvent[] = [];
    const events = new RunEventEmitter((event) => received.push(event));

    events.emit('run.started', { runId: 'r1' });
    for (const [input, output, cost] of [
      [1000, 200, 0.001],
      [500, 100, null],
    ] as const) {
      events.emit('llm.call', {
        stepId: 's',
        model: 'm',
        inputTokens: input,
        outputTokens: output,
        latencyMs: 10,
        costUsd: cost,
        finishReason: 'stop',
      });
    }
    events.emit('tool.finished', {
      stepId: 't',
      tool: 'search_hotels',
      kind: 'tool',
      latencyMs: 5,
      ok: true,
    });

    expect(received.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
    expect(events.totals()).toMatchObject({
      llmCalls: 2,
      toolCalls: 1,
      inputTokens: 1500,
      outputTokens: 300,
      // unbekannter Preis (null) zählt als 0 statt die Summe zu verderben
      costUsd: 0.001,
    });
  });

  it('formatiert Ereignisse als SSE mit Typ, ID und Leerzeile am Ende', () => {
    const sse = formatSse({
      type: 'run.started',
      seq: 1,
      elapsedMs: 0,
      data: { runId: 'r1' },
    });
    expect(sse).toBe(
      'event: run.started\nid: 1\ndata: {"type":"run.started","seq":1,"elapsedMs":0,"data":{"runId":"r1"}}\n\n',
    );
  });
});

import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { HttpException } from '@nestjs/common';
import { AgentController, toRunError } from './agent.controller';
import type { AgentService } from './agent.service';
import { InMemoryAgentRunStore } from './runs/agent-run-store';
import type { RunEventEmitter } from './runs/run-event-emitter';

// Controller mit nachgebautem AgentService und Lauf-Speicher im Arbeitsspeicher
function controller(service: object, store = new InMemoryAgentRunStore()) {
  return new AgentController(service as unknown as AgentService, store);
}

// Nachgebaute Express-Response: sammelt alles, was geschrieben wird.
function fakeResponse() {
  const res = Object.assign(new EventEmitter(), {
    written: '',
    ended: false,
    status: jest.fn(),
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write(chunk: string) {
      res.written += chunk;
      return true;
    },
    end() {
      res.ended = true;
    },
  });
  return res;
}

function eventTypes(sse: string): string[] {
  return [...sse.matchAll(/^event: (.+)$/gm)].map((match) => match[1]);
}

describe('AgentController POST /agent/runs', () => {
  const user = { userId: 'user-a', role: 'guest' } as const;
  const body = { sessionId: 's1', message: 'Lissabon' };

  it('streamt den Lauf als SSE und schließt mit run.finished', async () => {
    const service = {
      sendMessage: jest.fn().mockResolvedValue({
        reply: 'Fertig',
        sources: [],
        searchAttempted: false,
      }),
    };
    const res = fakeResponse();

    await controller(service).run(user, body, res as unknown as Response);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/event-stream; charset=utf-8',
    );
    expect(eventTypes(res.written)).toEqual([
      'run.started',
      'sources',
      'message.completed',
      'run.finished',
    ]);
    expect(res.ended).toBe(true);
  });

  it('schickt die Stationen einer Route vor der Antwort', async () => {
    const stops = [
      { name: 'Wien', lat: 48.2, lng: 16.37 },
      { name: 'Prag', lat: 50.08, lng: 14.43 },
    ];
    const service = {
      sendMessage: jest.fn().mockResolvedValue({
        reply: 'Fertig',
        sources: [],
        searchAttempted: false,
        route: stops,
      }),
    };
    const res = fakeResponse();

    await controller(service).run(user, body, res as unknown as Response);

    expect(eventTypes(res.written)).toEqual([
      'run.started',
      'stops.updated',
      'sources',
      'message.completed',
      'run.finished',
    ]);
  });

  it('meldet ein Rate-Limit als run.error mit verständlicher Nachricht', async () => {
    const service = {
      sendMessage: jest.fn().mockRejectedValue({ status: 429 }),
    };
    const res = fakeResponse();

    await controller(service).run(user, body, res as unknown as Response);

    expect(eventTypes(res.written)).toEqual(['run.started', 'run.error']);
    expect(res.written).toContain('"code":"rate_limited"');
    expect(res.ended).toBe(true);
  });

  it('meldet ein aufgebrauchtes Kontingent mit ungefährer Wartezeit', async () => {
    // Groq bei aufgebrauchtem Tageskontingent: retry-after in Sekunden
    const error = {
      status: 429,
      headers: new Headers({ 'retry-after': '1642' }),
    };
    const service = { sendMessage: jest.fn().mockRejectedValue(error) };
    const res = fakeResponse();

    await controller(service).run(user, body, res as unknown as Response);

    expect(res.written).toContain('"code":"quota_exhausted"');
    expect(res.written).toContain('in etwa 28 Minuten');
  });

  it('lehnt ungültige Anfragen vor dem Stream mit 400 ab', async () => {
    const res = fakeResponse();
    await expect(
      controller({}).run(
        user,
        { sessionId: '', message: 'x' },
        res as unknown as Response,
      ),
    ).rejects.toThrow('sessionId');
    expect(res.flushHeaders).not.toHaveBeenCalled();
  });
});

describe('AgentController: Läufe speichern', () => {
  const user = { userId: 'user-a', role: 'guest' } as const;
  const body = { sessionId: 's1', message: 'Lissabon' };

  // AgentService, der wie der echte zwei LLM-Aufrufe und ein Tool meldet
  function serviceWithSteps() {
    return {
      sendMessage: jest.fn(
        (_u: string, _s: string, _m: string, events: RunEventEmitter) => {
          for (const [stepId, input, output] of [
            ['l1', 1800, 40],
            ['l2', 2100, 350],
          ] as const) {
            events.emit('llm.started', { stepId });
            events.emit('llm.call', {
              stepId,
              model: 'm',
              inputTokens: input,
              outputTokens: output,
              latencyMs: 10,
              costUsd: 0.0005,
              finishReason: 'stop',
            });
          }
          events.emit('tool.started', { stepId: 't1', tool: 'get_weather' });
          events.emit('tool.finished', {
            stepId: 't1',
            tool: 'get_weather',
            kind: 'tool',
            latencyMs: 3,
            ok: true,
          });
          return Promise.resolve({
            reply: 'Fertig',
            sources: [],
            searchAttempted: false,
          });
        },
      ),
    };
  }

  it('speichert den Lauf einmal am Ende mit allen Ereignissen und Summen', async () => {
    const store = new InMemoryAgentRunStore();
    const save = jest.spyOn(store, 'save');
    const res = fakeResponse();

    await controller(serviceWithSteps(), store).run(
      user,
      body,
      res as unknown as Response,
    );

    expect(save).toHaveBeenCalledTimes(1);
    const [saved] = [...store.runs.values()];
    expect(saved).toMatchObject({
      userId: 'user-a',
      sessionId: 's1',
      status: 'OK',
      totals: { llmCalls: 2, toolCalls: 1 },
    });
    // Dieselben Ereignisse, die der Client bekommen hat, in derselben Reihenfolge
    expect(saved.events.map((event) => event.type)).toEqual(
      eventTypes(res.written),
    );
    // Die Summen passen zu den einzelnen LLM-Aufrufen
    const callTokens = saved.events
      .filter((event) => event.type === 'llm.call')
      .reduce(
        (sum, event) => sum + event.data.inputTokens + event.data.outputTokens,
        0,
      );
    expect(callTokens).toBe(1800 + 40 + 2100 + 350);
    expect(saved.totals.inputTokens + saved.totals.outputTokens).toBe(
      callTokens,
    );
  });

  it('schickt die ID des gespeicherten Laufs schon mit run.started', async () => {
    const store = new InMemoryAgentRunStore();
    const res = fakeResponse();

    await controller(serviceWithSteps(), store).run(
      user,
      body,
      res as unknown as Response,
    );

    const [saved] = [...store.runs.values()];
    expect(saved.events[0]).toMatchObject({
      type: 'run.started',
      data: { runId: saved.id },
    });
    expect(res.written).toContain(`"runId":"${saved.id}"`);
  });

  it('speichert einen fehlgeschlagenen Lauf mit Status ERROR', async () => {
    const store = new InMemoryAgentRunStore();
    const service = {
      sendMessage: jest.fn().mockRejectedValue({ status: 429 }),
    };

    await controller(service, store).run(
      user,
      body,
      fakeResponse() as unknown as Response,
    );

    const [saved] = [...store.runs.values()];
    expect(saved.status).toBe('ERROR');
    expect(saved.events.map((event) => event.type)).toEqual([
      'run.started',
      'run.error',
    ]);
  });

  it('markiert einen Lauf als ABORTED, wenn der Client vorher gegangen ist', async () => {
    const store = new InMemoryAgentRunStore();
    const res = fakeResponse();
    const service = {
      sendMessage: jest.fn(() => {
        res.emit('close');
        return Promise.resolve({
          reply: 'Fertig',
          sources: [],
          searchAttempted: false,
        });
      }),
    };

    await controller(service, store).run(
      user,
      body,
      res as unknown as Response,
    );

    const [saved] = [...store.runs.values()];
    expect(saved.status).toBe('ABORTED');
    // Der Agent lief zu Ende, das Replay zeigt trotzdem die Antwort
    expect(saved.events.at(-1)?.type).toBe('run.finished');
  });

  it('beendet den Lauf normal, wenn das Speichern fehlschlägt', async () => {
    const store = new InMemoryAgentRunStore();
    jest.spyOn(store, 'save').mockRejectedValue(new Error('DB weg'));
    const res = fakeResponse();

    await expect(
      controller(serviceWithSteps(), store).run(
        user,
        body,
        res as unknown as Response,
      ),
    ).resolves.toBeUndefined();
    expect(eventTypes(res.written).at(-1)).toBe('run.finished');
    expect(res.ended).toBe(true);
  });
});

describe('AgentController POST /agent/chat', () => {
  const user = { userId: 'user-a', role: 'guest' } as const;
  const body = { sessionId: 's1', message: 'Lissabon' };

  it('gibt ein Rate-Limit des LLM als 429 statt 500 weiter', async () => {
    const service = {
      sendMessage: jest.fn().mockRejectedValue({ status: 429 }),
    };
    const call = controller(service).chat(user, body);

    await expect(call).rejects.toBeInstanceOf(HttpException);
    await expect(call).rejects.toMatchObject({ status: 429 });
  });

  it('lässt andere Fehler unverändert durch', async () => {
    const error = new Error('db down');
    const service = { sendMessage: jest.fn().mockRejectedValue(error) };

    await expect(controller(service).chat(user, body)).rejects.toBe(error);
  });
});

describe('toRunError', () => {
  it('bleibt bei kurzer Wartezeit bei "zu viele Anfragen"', () => {
    expect(
      toRunError({ status: 429, headers: { 'retry-after': '5' } }).code,
    ).toBe('rate_limited');
  });
});

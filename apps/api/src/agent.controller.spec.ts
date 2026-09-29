import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { HttpException, NotFoundException } from '@nestjs/common';
import { AgentController, toRunError } from './agent.controller';
import type { AgentService } from './agent.service';
import type { Orchestrator } from './orchestrator/orchestrator';
import { InMemoryAgentRunStore } from './runs/agent-run-store';
import type { RunEventEmitter } from './runs/run-event-emitter';

// Controller mit nachgebautem AgentService und Lauf-Speicher im Arbeitsspeicher
function controller(
  service: object,
  store = new InMemoryAgentRunStore(),
  orchestrator: object = {},
) {
  return new AgentController(
    service as unknown as AgentService,
    store,
    orchestrator as unknown as Orchestrator,
  );
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

describe('AgentController GET /agent/runs/:id', () => {
  const owner = { userId: 'user-a', role: 'guest' } as const;
  const stranger = { userId: 'user-b', role: 'guest' } as const;

  async function storeWithRun() {
    const store = new InMemoryAgentRunStore();
    const res = fakeResponse();
    await controller(
      {
        sendMessage: jest.fn().mockResolvedValue({
          reply: 'Drei Tage Lissabon',
          sources: [],
          searchAttempted: false,
        }),
      },
      store,
    ).run(
      owner,
      { sessionId: 's1', message: 'Lissabon' },
      res as unknown as Response,
    );
    const [runId] = store.runs.keys();
    return { store, runId };
  }

  it('liefert dem Eigentümer Status, Summen und Ereignisse', async () => {
    const { store, runId } = await storeWithRun();

    const run = await controller({}, store).findRun(owner, runId);

    expect(run).toMatchObject({ id: runId, status: 'ok' });
    expect(run.totals).toHaveProperty('durationMs');
    expect(run.events.map((event) => event.type)).toEqual([
      'run.started',
      'sources',
      'message.completed',
      'run.finished',
    ]);
  });

  it('antwortet einem fremden Nutzer mit 404', async () => {
    const { store, runId } = await storeWithRun();

    await expect(
      controller({}, store).findRun(stranger, runId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('antwortet bei unbekannter ID mit 404', async () => {
    await expect(
      controller({}).findRun(owner, 'gibt-es-nicht'),
    ).rejects.toMatchObject({ status: 404 });
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

describe('AgentController AGENT_MODE', () => {
  const user = { userId: 'user-a', role: 'guest' } as const;
  const body = { sessionId: 's1', message: 'Lissabon' };
  const original = process.env.AGENT_MODE;
  const originalLocked = process.env.AGENT_MODE_LOCKED;
  afterEach(() => {
    if (original === undefined) delete process.env.AGENT_MODE;
    else process.env.AGENT_MODE = original;
    if (originalLocked === undefined) delete process.env.AGENT_MODE_LOCKED;
    else process.env.AGENT_MODE_LOCKED = originalLocked;
  });

  const classicService = () => ({
    sendMessage: jest.fn().mockResolvedValue({
      reply: 'ok',
      sources: [],
      searchAttempted: false,
    }),
  });
  const multiOrchestrator = () => ({
    run: jest.fn().mockResolvedValue({
      reply: 'Wohin?',
      sources: [],
      searchAttempted: false,
    }),
  });

  function runStarted(sse: string) {
    const line = sse.split('\n').find((l) => l.startsWith('data: '));
    return (JSON.parse(line!.slice(6)) as { data: object }).data;
  }

  it('nutzt ohne Angabe den Classic-Agenten und meldet den Modus', async () => {
    delete process.env.AGENT_MODE;
    const service = {
      sendMessage: jest.fn().mockResolvedValue({
        reply: 'ok',
        sources: [],
        searchAttempted: false,
      }),
    };
    const orchestrator = { run: jest.fn() };
    const res = fakeResponse();

    await controller(service, undefined, orchestrator).run(
      user,
      body,
      res as unknown as Response,
    );

    expect(service.sendMessage).toHaveBeenCalled();
    expect(orchestrator.run).not.toHaveBeenCalled();
    expect(runStarted(res.written)).toMatchObject({ mode: 'classic' });
  });

  it('startet mit AGENT_MODE=multi den Orchestrator, dessen Ereignisse mitlaufen', async () => {
    process.env.AGENT_MODE = 'multi';
    const service = { sendMessage: jest.fn() };
    const orchestrator = {
      run: jest.fn(
        (_input: unknown, emit: (type: string, data: unknown) => void) => {
          emit('agent.started', {
            stepId: 'a1',
            agent: 'planner',
            task: 'triage',
          });
          return Promise.resolve({
            reply: 'Wohin?',
            sources: [],
            searchAttempted: false,
          });
        },
      ),
    };
    const res = fakeResponse();

    await controller(service, undefined, orchestrator).run(
      user,
      body,
      res as unknown as Response,
    );

    expect(service.sendMessage).not.toHaveBeenCalled();
    expect(orchestrator.run).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-a',
        sessionId: 's1',
        message: 'Lissabon',
      }),
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(runStarted(res.written)).toMatchObject({ mode: 'multi' });
    expect(eventTypes(res.written)).toEqual([
      'run.started',
      'agent.started',
      'sources',
      'message.completed',
      'run.finished',
    ]);
  });

  it('POST /agent/chat bleibt auch mit AGENT_MODE=multi beim Classic-Agenten', async () => {
    process.env.AGENT_MODE = 'multi';
    const service = {
      sendMessage: jest.fn().mockResolvedValue({
        reply: 'ok',
        sources: [],
        searchAttempted: false,
      }),
    };
    const orchestrator = { run: jest.fn() };

    await controller(service, undefined, orchestrator).chat(user, body);

    expect(service.sendMessage).toHaveBeenCalled();
    expect(orchestrator.run).not.toHaveBeenCalled();
  });

  it('nutzt den Modus aus dem Body statt des Server-Defaults', async () => {
    delete process.env.AGENT_MODE;
    const service = classicService();
    const orchestrator = multiOrchestrator();
    const res = fakeResponse();

    await controller(service, undefined, orchestrator).run(
      user,
      { ...body, mode: 'multi' },
      res as unknown as Response,
    );

    expect(orchestrator.run).toHaveBeenCalled();
    expect(service.sendMessage).not.toHaveBeenCalled();
    expect(runStarted(res.written)).toMatchObject({ mode: 'multi' });
  });

  it('wählt per Body classic, auch wenn der Server-Default multi ist', async () => {
    process.env.AGENT_MODE = 'multi';
    const service = classicService();
    const orchestrator = multiOrchestrator();
    const res = fakeResponse();

    await controller(service, undefined, orchestrator).run(
      user,
      { ...body, mode: 'classic' },
      res as unknown as Response,
    );

    expect(service.sendMessage).toHaveBeenCalled();
    expect(orchestrator.run).not.toHaveBeenCalled();
    expect(runStarted(res.written)).toMatchObject({ mode: 'classic' });
  });

  it.each([['swarm'], [''], [42], [{ mode: 'multi' }]])(
    'lehnt mode %p mit 400 ab, bevor der Stream beginnt',
    async (mode) => {
      const service = classicService();
      const orchestrator = multiOrchestrator();
      const res = fakeResponse();

      await expect(
        controller(service, undefined, orchestrator).run(
          user,
          { ...body, mode } as unknown as typeof body,
          res as unknown as Response,
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(res.flushHeaders).not.toHaveBeenCalled();
      expect(res.written).toBe('');
      expect(service.sendMessage).not.toHaveBeenCalled();
      expect(orchestrator.run).not.toHaveBeenCalled();
    },
  );

  it('ignoriert mit AGENT_MODE_LOCKED=true die Wahl des Clients', async () => {
    delete process.env.AGENT_MODE;
    process.env.AGENT_MODE_LOCKED = 'true';
    const service = classicService();
    const orchestrator = multiOrchestrator();
    const res = fakeResponse();

    await controller(service, undefined, orchestrator).run(
      user,
      { ...body, mode: 'multi' },
      res as unknown as Response,
    );

    expect(service.sendMessage).toHaveBeenCalled();
    expect(orchestrator.run).not.toHaveBeenCalled();
    expect(runStarted(res.written)).toMatchObject({ mode: 'classic' });
  });

  it('erzwingt mit Sperre auch einen Server-Default multi', async () => {
    process.env.AGENT_MODE = 'multi';
    process.env.AGENT_MODE_LOCKED = 'true';
    const service = classicService();
    const orchestrator = multiOrchestrator();
    const res = fakeResponse();

    await controller(service, undefined, orchestrator).run(
      user,
      { ...body, mode: 'classic' },
      res as unknown as Response,
    );

    expect(orchestrator.run).toHaveBeenCalled();
    expect(service.sendMessage).not.toHaveBeenCalled();
    expect(runStarted(res.written)).toMatchObject({ mode: 'multi' });
  });
});

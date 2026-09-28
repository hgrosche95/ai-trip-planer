import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { HttpException } from '@nestjs/common';
import { AgentController, toRunError } from './agent.controller';
import type { AgentService } from './agent.service';

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

    await new AgentController(service as unknown as AgentService).run(
      user,
      body,
      res as unknown as Response,
    );

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

    await new AgentController(service as unknown as AgentService).run(
      user,
      body,
      res as unknown as Response,
    );

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

    await new AgentController(service as unknown as AgentService).run(
      user,
      body,
      res as unknown as Response,
    );

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

    await new AgentController(service as unknown as AgentService).run(
      user,
      body,
      res as unknown as Response,
    );

    expect(res.written).toContain('"code":"quota_exhausted"');
    expect(res.written).toContain('in etwa 28 Minuten');
  });

  it('lehnt ungültige Anfragen vor dem Stream mit 400 ab', async () => {
    const res = fakeResponse();
    await expect(
      new AgentController({} as AgentService).run(
        user,
        { sessionId: '', message: 'x' },
        res as unknown as Response,
      ),
    ).rejects.toThrow('sessionId');
    expect(res.flushHeaders).not.toHaveBeenCalled();
  });
});

describe('AgentController POST /agent/chat', () => {
  const user = { userId: 'user-a', role: 'guest' } as const;
  const body = { sessionId: 's1', message: 'Lissabon' };

  it('gibt ein Rate-Limit des LLM als 429 statt 500 weiter', async () => {
    const service = {
      sendMessage: jest.fn().mockRejectedValue({ status: 429 }),
    };
    const call = new AgentController(service as unknown as AgentService).chat(
      user,
      body,
    );

    await expect(call).rejects.toBeInstanceOf(HttpException);
    await expect(call).rejects.toMatchObject({ status: 429 });
  });

  it('lässt andere Fehler unverändert durch', async () => {
    const error = new Error('db down');
    const service = { sendMessage: jest.fn().mockRejectedValue(error) };

    await expect(
      new AgentController(service as unknown as AgentService).chat(user, body),
    ).rejects.toBe(error);
  });
});

describe('toRunError', () => {
  it('bleibt bei kurzer Wartezeit bei "zu viele Anfragen"', () => {
    expect(
      toRunError({ status: 429, headers: { 'retry-after': '5' } }).code,
    ).toBe('rate_limited');
  });
});

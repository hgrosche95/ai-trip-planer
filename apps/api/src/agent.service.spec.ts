import { AgentService, MAX_TOOL_ITERATIONS } from './agent.service';
import type { ItinerariesService } from './itineraries.service';
import type { LlmChatResult, LlmMessage } from './llm/llm-provider.interface';

function toolCallResult(
  name: string,
  args: Record<string, unknown>,
): LlmChatResult {
  return {
    content: null,
    toolCalls: [{ id: `call-${name}`, name, arguments: args }],
    finishReason: 'tool_calls',
    usage: { inputTokens: 1, outputTokens: 1 },
    model: 'fake',
  };
}

function textResult(content: string): LlmChatResult {
  return {
    content,
    toolCalls: [],
    finishReason: 'stop',
    usage: { inputTokens: 1, outputTokens: 1 },
    model: 'fake',
  };
}

describe('AgentService', () => {
  let llm: { chat: jest.Mock };
  let itineraries: { create: jest.Mock };
  let agent: AgentService;

  beforeEach(() => {
    llm = { chat: jest.fn() };
    itineraries = { create: jest.fn().mockResolvedValue({ id: 'plan-1' }) };
    agent = new AgentService(itineraries as unknown as ItinerariesService, llm);
  });

  it(`bricht die Tool-Schleife nach ${MAX_TOOL_ITERATIONS} Runden ab`, async () => {
    // Ein Modell, das nie aufhört, Tools aufzurufen
    llm.chat.mockResolvedValue(
      toolCallResult('search_hotels', { city: 'Wien' }),
    );

    const result = await agent.sendMessage('user-a', 'session-1', 'Hallo');

    // 1 erster Aufruf + MAX_TOOL_ITERATIONS Folgeaufrufe, dann Schluss
    expect(llm.chat).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS + 1);
    expect(result.reply).toMatch(/eingrenzen/);
  });

  it('speichert Pläne aus dem Chat unter dem anfragenden Nutzer', async () => {
    const plan = {
      destination: 'Wien',
      startDate: '2026-09-01',
      endDate: '2026-09-04',
      budgetCents: 50000,
      stops: [],
    };
    llm.chat
      .mockResolvedValueOnce(toolCallResult('save_itinerary', plan))
      .mockResolvedValueOnce(textResult('Gespeichert!'));

    await agent.sendMessage('user-a', 'session-1', 'Speicher das');

    expect(itineraries.create).toHaveBeenCalledWith('user-a', plan);
  });

  it('gibt einen ungültigen Plan als Tool-Fehler an das Modell zurück', async () => {
    const invalid = {
      destination: 'Wien',
      startDate: 'quatsch',
      endDate: '2026-09-04',
      budgetCents: 50000,
      stops: [],
    };
    llm.chat
      .mockResolvedValueOnce(toolCallResult('save_itinerary', invalid))
      .mockResolvedValueOnce(textResult('Ich korrigiere das Datum.'));

    const result = await agent.sendMessage('user-a', 'session-1', 'Speicher');

    expect(itineraries.create).not.toHaveBeenCalled();
    // Das Modell bekommt die Fehlermeldung als Tool-Ergebnis zu sehen
    const calls = llm.chat.mock.calls as [LlmMessage[]][];
    const toolMessage = calls[1][0].find((m) => m.role === 'tool');
    expect(toolMessage?.toolResults?.[0].content).toContain('startDate');
    expect(result.reply).toBe('Ich korrigiere das Datum.');
  });

  it('trennt Chat-Verläufe verschiedener Nutzer mit gleicher sessionId', async () => {
    llm.chat.mockResolvedValue(textResult('ok'));

    await agent.sendMessage('user-a', 'gleiche-session', 'Geheimnis von A');
    await agent.sendMessage('user-b', 'gleiche-session', 'Hallo');

    const calls = llm.chat.mock.calls as [LlmMessage[]][];
    const messagesForB = calls[1][0];
    expect(messagesForB.some((m) => m.content === 'Geheimnis von A')).toBe(
      false,
    );
  });
});

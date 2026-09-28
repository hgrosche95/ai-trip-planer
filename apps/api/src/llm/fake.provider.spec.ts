import { itineraryValidationErrors } from '../itinerary.dto';
import { FakeLlmProvider } from './fake.provider';
import type { LlmMessage } from './llm-provider.interface';

describe('FakeLlmProvider', () => {
  const fake = new FakeLlmProvider();
  const chat = (messages: LlmMessage[]) => fake.chat(messages);

  it('speichert bei einer Planungsanfrage einen Plan für das genannte Ziel', async () => {
    const result = await chat([
      {
        role: 'user',
        content: 'Plane mir 3 Tage Lissabon und speichere den Plan',
      },
    ]);

    expect(result.finishReason).toBe('tool_calls');
    const save = result.toolCalls.find(
      (call) => call.name === 'save_itinerary',
    );
    expect(save?.arguments.destination).toBe('Lissabon');
    expect(result.toolCalls.map((call) => call.name)).toContain(
      'show_destination_on_globe',
    );
  });

  it('erzeugt einen Plan, den die echte Validierung akzeptiert', async () => {
    const result = await chat([{ role: 'user', content: 'Plane Wien' }]);
    const save = result.toolCalls.find(
      (call) => call.name === 'save_itinerary',
    );
    expect(itineraryValidationErrors(save?.arguments)).toEqual([]);
  });

  it('durchsucht bei einer Frage die Wissensbasis', async () => {
    const result = await chat([
      { role: 'user', content: 'Was kann man in Lissabon essen?' },
    ]);

    expect(result.toolCalls).toEqual([
      expect.objectContaining({
        name: 'search_travel_knowledge',
        arguments: { query: 'Was kann man in Lissabon essen?' },
      }),
    ]);
  });

  it('nennt die gefundenen Quellen, auch bei gekürztem Tool-Ergebnis', async () => {
    const result = await chat([
      { role: 'user', content: 'Was kann man in Lissabon essen?' },
      {
        role: 'assistant',
        toolCalls: [
          { id: 's1', name: 'search_travel_knowledge', arguments: {} },
        ],
      },
      {
        role: 'tool',
        toolResults: [
          {
            toolCallId: 's1',
            content:
              '{"available":true,"results":[{"title":"Lissabon","source":"Wikivoy',
          },
        ],
      },
    ]);

    expect(result.finishReason).toBe('stop');
    expect(result.content).toContain('**Lissabon**');
  });

  it('bestätigt einen gespeicherten Plan', async () => {
    const result = await chat([
      { role: 'user', content: 'Speicher das' },
      {
        role: 'assistant',
        toolCalls: [{ id: 'p1', name: 'save_itinerary', arguments: {} }],
      },
      {
        role: 'tool',
        toolResults: [
          { toolCallId: 'p1', content: '{"saved":true,"itineraryId":"x"}' },
        ],
      },
    ]);

    expect(result.content).toMatch(/gespeichert/);
  });
});

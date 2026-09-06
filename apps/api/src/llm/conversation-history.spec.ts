import { trimHistory, truncateToolResult } from './conversation-history';
import { LlmMessage } from './llm-provider.interface';

describe('trimHistory', () => {
  it('keeps everything when the history is under the limit', () => {
    const history: LlmMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ];

    expect(trimHistory(history, 10)).toEqual(history);
  });

  it('keeps only the last N messages', () => {
    const history: LlmMessage[] = Array.from({ length: 5 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`,
    }));

    expect(trimHistory(history, 2)).toEqual(history.slice(-2));
  });

  it('drops a leading orphaned tool-result message left over from trimming', () => {
    const history: LlmMessage[] = [
      { role: 'user', content: 'plan trip' },
      {
        role: 'assistant',
        toolCalls: [{ id: 'call-1', name: 'search_flights', arguments: {} }],
      },
      { role: 'tool', toolResults: [{ toolCallId: 'call-1', content: '{}' }] },
      { role: 'assistant', content: 'here are flights' },
      { role: 'user', content: 'thanks' },
    ];

    // A cut at 3 would naively land on [tool, assistant, user] - the tool
    // message has no matching assistant tool_calls message left, which
    // every provider adapter would reject.
    const trimmed = trimHistory(history, 3);

    expect(trimmed.some((m) => m.role === 'tool')).toBe(false);
    expect(trimmed).toEqual(history.slice(-2));
  });

  it('can trim down to an empty history', () => {
    const history: LlmMessage[] = [
      { role: 'tool', toolResults: [{ toolCallId: 'call-1', content: '{}' }] },
    ];

    expect(trimHistory(history, 1)).toEqual([]);
  });
});

describe('truncateToolResult', () => {
  it('returns content unchanged when within the limit', () => {
    expect(truncateToolResult('short', 10)).toBe('short');
  });

  it('truncates and appends a marker when over the limit', () => {
    const content = 'x'.repeat(20);

    const result = truncateToolResult(content, 10);

    expect(result.startsWith('x'.repeat(10))).toBe(true);
    expect(result).toContain('gekürzt');
  });
});

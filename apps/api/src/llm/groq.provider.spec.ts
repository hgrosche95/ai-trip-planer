import { GroqProvider } from './groq.provider';

// Groq ist aus Tests nicht erreichbar: das OpenAI-SDK wird ersetzt. create()
// liefert wie das echte SDK ein Objekt mit withResponse().
const create = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create } },
  })),
}));

const completion = {
  model: 'openai/gpt-oss-120b',
  choices: [
    {
      message: { content: 'Hallo', tool_calls: undefined },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 120, completion_tokens: 30 },
};

function respondWith(headers: Record<string, string>) {
  create.mockReturnValue({
    withResponse: () =>
      Promise.resolve({
        data: completion,
        response: new Response(null, { headers }),
        request_id: null,
      }),
  });
}

describe('GroqProvider', () => {
  beforeEach(() => create.mockReset());

  it('reicht die x-ratelimit-*-Header als rateLimit durch', async () => {
    respondWith({
      'x-ratelimit-remaining-tokens': '2100',
      'x-ratelimit-reset-tokens': '44.1s',
      'x-ratelimit-remaining-requests': '998',
      'x-ratelimit-reset-requests': '2m52.8s',
    });

    const result = await new GroqProvider().chat(
      [{ role: 'user', content: 'Hi' }],
      [],
      { maxTokens: 100 },
    );

    expect(result).toMatchObject({
      content: 'Hallo',
      finishReason: 'stop',
      usage: { inputTokens: 120, outputTokens: 30 },
      rateLimit: {
        remainingTokens: 2100,
        resetTokensMs: 44100,
        remainingRequests: 998,
        resetRequestsMs: 172800,
      },
    });
  });

  it('lässt rateLimit weg, wenn die Header fehlen', async () => {
    respondWith({});

    const result = await new GroqProvider().chat(
      [{ role: 'user', content: 'Hi' }],
      [],
      { maxTokens: 100 },
    );

    expect(result.rateLimit).toBeUndefined();
  });
});

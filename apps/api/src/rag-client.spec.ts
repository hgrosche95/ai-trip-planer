import { searchCareerKnowledge, searchTravelKnowledge } from './rag-client';

describe('searchTravelKnowledge', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('maps a successful response to the flattened hit shape', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            {
              content: 'Pastéis de Nata sind das bekannteste Gebäck.',
              score: 0.68,
              document_title: 'Lissabon – Reiseziel-Überblick',
              document_source: 'Eigene Recherche',
              document_url: null,
              document_license: 'Eigene Inhalte',
            },
          ],
          reranked: false,
        }),
    });

    const result = await searchTravelKnowledge('Was isst man in Lissabon?');

    expect(result.available).toBe(true);
    expect(result.results).toEqual([
      {
        content: 'Pastéis de Nata sind das bekannteste Gebäck.',
        title: 'Lissabon – Reiseziel-Überblick',
        source: 'Eigene Recherche',
        license: 'Eigene Inhalte',
        url: null,
        score: 0.68,
      },
    ]);
  });

  it('returns a fallback when the RAG service responds with an error status', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({}),
    });

    const result = await searchTravelKnowledge('Frage');

    expect(result.available).toBe(false);
    expect(result.results).toEqual([]);
    expect(result.error).toContain('503');
  });

  it('returns a fallback instead of throwing when the RAG service is unreachable', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('connect ECONNREFUSED'));

    const result = await searchTravelKnowledge('Frage');

    expect(result.available).toBe(false);
    expect(result.results).toEqual([]);
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('sendet collection "travel" an den RAG-Service', async () => {
    let capturedInit: RequestInit | undefined;
    global.fetch = jest.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ results: [], reranked: false }),
      } as Response);
    });

    await searchTravelKnowledge('Frage');

    const body = JSON.parse(capturedInit?.body as string) as {
      collection: string;
    };
    expect(body.collection).toBe('travel');
  });
});

describe('searchCareerKnowledge', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('sendet collection "jobs" an den RAG-Service', async () => {
    let capturedInit: RequestInit | undefined;
    global.fetch = jest.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ results: [], reranked: false }),
      } as Response);
    });

    await searchCareerKnowledge('Frage');

    const body = JSON.parse(capturedInit?.body as string) as {
      collection: string;
    };
    expect(body.collection).toBe('jobs');
  });
});

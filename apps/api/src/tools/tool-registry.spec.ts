import type { ItinerariesService } from '../itineraries.service';
import { createAgentTools } from './index';
import { ToolRegistry } from './tool-registry';
import type { AgentTool } from './tool-registry';

const hit = {
  title: 'Wien – Reiseziel-Überblick',
  source: 'wikivoyage',
  license: 'CC BY-SA',
  url: null,
  score: 0.7,
};

const fakeRetriever: AgentTool<{ query: string }, { results: (typeof hit)[] }> =
  {
    kind: 'retriever',
    definition: { name: 'fake_search', description: '', parameters: {} },
    execute: () => ({ results: [hit] }),
    sources: (output) => output.results,
  };

const echoTool: AgentTool<{ text: string }> = {
  kind: 'tool',
  definition: { name: 'echo', description: '', parameters: {} },
  execute: (input, { userId }) => ({ text: input.text, userId }),
};

describe('ToolRegistry', () => {
  const registry = new ToolRegistry([fakeRetriever, echoTool]);

  it('gibt die Definitionen aller Tools fürs Modell zurück', () => {
    expect(registry.definitions().map((d) => d.name)).toEqual([
      'fake_search',
      'echo',
    ]);
  });

  it('führt ein Tool mit Eingabe und Nutzerkontext aus', async () => {
    const run = await registry.execute(
      'echo',
      { text: 'hallo' },
      { userId: 'user-a' },
    );

    expect(run).toEqual({
      output: { text: 'hallo', userId: 'user-a' },
      retrieval: false,
      sources: [],
    });
  });

  it('meldet Treffer eines Retrievers als Quellen', async () => {
    const run = await registry.execute(
      'fake_search',
      { query: 'Wien' },
      { userId: 'user-a' },
    );

    expect(run.retrieval).toBe(true);
    expect(run.sources).toEqual([hit]);
  });

  it('gibt unbekannte Tools als Fehler ans Modell zurück', async () => {
    const run = await registry.execute('gibt_es_nicht', {}, { userId: 'u' });

    expect(run.output).toEqual({ error: 'Unbekanntes Tool: gibt_es_nicht' });
  });

  it('lehnt doppelte Tool-Namen ab', () => {
    expect(() => new ToolRegistry([echoTool, echoTool])).toThrow(/doppelt/);
  });
});

describe('createAgentTools', () => {
  it('registriert alle Tools des Chat-Agenten', () => {
    const registry = createAgentTools({} as ItinerariesService);

    expect(registry.definitions().map((d) => d.name)).toEqual([
      'search_travel_knowledge',
      'search_flights',
      'search_hotels',
      'save_itinerary',
    ]);
  });
});

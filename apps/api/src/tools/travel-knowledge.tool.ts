import { searchTravelKnowledge } from '../rag-client';
import type { TravelKnowledgeSearchResult } from '../rag-client';
import type { AgentTool } from './tool-registry';

export const travelKnowledgeTool: AgentTool<
  { query: string },
  TravelKnowledgeSearchResult
> = {
  kind: 'retriever',
  definition: {
    name: 'search_travel_knowledge',
    description:
      'Durchsucht eine kuratierte Wissensbasis zu Reisezielen (Sehenswürdigkeiten, Essen & Trinken, Transport) nach Fakten. Bei Faktenfragen zu einem konkreten Reiseziel immer zuerst dieses Tool nutzen, statt aus dem Gedächtnis zu antworten - die Treffer enthalten Quellenangaben, mit denen du deine Aussage belegen kannst. Liefert das Tool keine passenden Treffer, sag das dem Nutzer ehrlich, statt zu raten.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Die Suchanfrage, z.B. "Was kann man in Lissabon essen?"',
        },
      },
      required: ['query'],
    },
  },
  execute: (input) => searchTravelKnowledge(input.query),
  sources: (result) =>
    result.results.map((hit) => ({
      title: hit.title,
      source: hit.source,
      license: hit.license,
      url: hit.url,
      score: hit.score,
    })),
  // In Langfuse die Top-Treffer (Titel/Quelle/Score, keine Nutzerdaten)
  // statt eines generischen Tool-Aufrufs
  trace: (result) => ({
    output: result.results.map((hit) => ({
      title: hit.title,
      source: hit.source,
      score: hit.score,
    })),
    metadata: {
      available: result.available,
      hitCount: result.results.length,
    },
  }),
};

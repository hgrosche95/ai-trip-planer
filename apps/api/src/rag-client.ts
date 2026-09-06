interface RagServiceSearchResult {
  content: string;
  score: number;
  document_title: string;
  document_source: string;
  document_url: string | null;
  document_license: string;
}

interface RagServiceSearchResponse {
  results: RagServiceSearchResult[];
  reranked: boolean;
}

export interface TravelKnowledgeHit {
  content: string;
  title: string;
  source: string;
  license: string;
  url: string | null;
  score: number;
}

export interface TravelKnowledgeSearchResult {
  available: boolean;
  results: TravelKnowledgeHit[];
  error?: string;
}

const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL ?? 'http://localhost:8001';
const RAG_SEARCH_TIMEOUT_MS = Number(process.env.RAG_SEARCH_TIMEOUT_MS ?? 5000);
// Bewusst klein (3 statt z.B. 10): das Tool-Ergebnis geht als JSON-Text ins
// Kontextfenster des LLM - mehr Treffer heißt direkt mehr Tokens pro
// Suchaufruf, relevant für Groqs 8.000-TPM-Limit (siehe Phase 1.3).
const RAG_SEARCH_TOP_K = Number(process.env.RAG_SEARCH_TOP_K ?? 3);

/**
 * Ruft den RAG-Service auf. Wirft nie - bei Nichterreichbarkeit, Timeout
 * oder Fehlerstatus kommt ein `available: false`-Ergebnis mit Fehlertext
 * zurück, das dem Modell als Tool-Ergebnis mitgeteilt wird. Ohne diesen
 * Fallback würde ein down/langsamer RAG-Service den kompletten
 * Tool-Use-Loop (und damit den Chat) hart abbrechen lassen, statt dass das
 * Modell dem Nutzer einfach ehrlich sagt, dass es gerade nicht nachschlagen
 * konnte.
 */
export async function searchTravelKnowledge(
  query: string,
): Promise<TravelKnowledgeSearchResult> {
  try {
    const response = await fetch(`${RAG_SERVICE_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, top_k: RAG_SEARCH_TOP_K }),
      signal: AbortSignal.timeout(RAG_SEARCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        available: false,
        results: [],
        error: `RAG-Service antwortete mit Status ${response.status}`,
      };
    }

    const data = (await response.json()) as RagServiceSearchResponse;
    return {
      available: true,
      results: data.results.map((r) => ({
        content: r.content,
        title: r.document_title,
        source: r.document_source,
        license: r.document_license,
        url: r.document_url,
        score: r.score,
      })),
    };
  } catch (error) {
    return {
      available: false,
      results: [],
      error:
        error instanceof Error
          ? `Wissensbasis-Suche nicht erreichbar: ${error.message}`
          : 'Wissensbasis-Suche nicht erreichbar.',
    };
  }
}

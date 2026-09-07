const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL ?? 'http://localhost:8001';

interface RagSearchHit {
  document_title: string;
}

interface RagSearchResponse {
  results: RagSearchHit[];
}

/**
 * Ruft services/rag direkt auf (nicht den Agenten) - die Retrieval-Metriken
 * sollen die Suche isoliert messen, ohne dass ein LLM-Aufruf des Agenten
 * dazwischenliegt.
 */
export async function searchTopK(
  query: string,
  topK: number,
): Promise<string[]> {
  const response = await fetch(`${RAG_SERVICE_URL}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, top_k: topK }),
  });
  if (!response.ok) {
    throw new Error(
      `RAG-Suche fehlgeschlagen (HTTP ${response.status}) für Query "${query}"`,
    );
  }
  const data = (await response.json()) as RagSearchResponse;
  return data.results.map((hit) => hit.document_title);
}

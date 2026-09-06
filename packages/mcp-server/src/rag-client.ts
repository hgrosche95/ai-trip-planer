const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL ?? 'http://localhost:8001';

export async function searchTravelKnowledge(
  query: string,
  topK = 5,
): Promise<unknown> {
  const response = await fetch(`${RAG_SERVICE_URL}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, top_k: topK }),
  });
  if (!response.ok) {
    throw new Error(
      `RAG-Suche gegen ${RAG_SERVICE_URL}/search fehlgeschlagen: HTTP ${response.status}`,
    );
  }
  return response.json();
}

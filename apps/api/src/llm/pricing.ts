// Listenpreise in US-$ pro 1 Mio. Tokens, für die Kostenanzeige im Trace.
// Stand 09/2026, vor Präsentationen gegen groq.com/pricing und
// anthropic.com/pricing prüfen. Im kostenlosen Groq-Tier zahlt man nichts,
// die Anzeige ist dann das "was es kosten würde"-Äquivalent.
const PRICES_PER_MILLION: Record<string, { input: number; output: number }> = {
  'openai/gpt-oss-120b': { input: 0.15, output: 0.6 },
  'openai/gpt-oss-20b': { input: 0.075, output: 0.3 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

// Die APIs melden teils Modellnamen mit Datums-Suffix
// (claude-haiku-4-5-20251001), deshalb Vergleich per Präfix.
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const key = Object.keys(PRICES_PER_MILLION).find((name) =>
    model.startsWith(name),
  );
  if (!key) return null;
  const price = PRICES_PER_MILLION[key];
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

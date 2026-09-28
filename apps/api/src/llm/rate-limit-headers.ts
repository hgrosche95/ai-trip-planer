import type { LlmRateLimit } from './llm-provider.interface';

// Ein Baustein einer Groq-Dauerangabe: Zahl plus Einheit, z. B. "2.5s"
const DURATION_PART = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
const UNIT_MS: Record<string, number> = {
  h: 3_600_000,
  m: 60_000,
  s: 1_000,
  ms: 1,
};

// Wandelt Groqs Dauer-Strings ("6.2s", "1m2.5s", "120ms", "2h3m0.5s") in
// Millisekunden. Eine nackte Zahl gilt als Sekunden (wie bei Retry-After).
// Alles, was nicht vollständig in dieses Muster passt, ergibt undefined:
// lieber keine Information als eine falsche Wartezeit.
export function parseDurationMs(
  value: string | null | undefined,
): number | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000);

  let total = 0;
  let consumed = 0;
  for (const match of text.matchAll(DURATION_PART)) {
    // Lücken oder fremde Zeichen zwischen den Bausteinen: ungültig
    if (match.index !== consumed) return undefined;
    total += Number(match[1]) * UNIT_MS[match[2]];
    consumed += match[0].length;
  }
  return consumed > 0 && consumed === text.length
    ? Math.round(total)
    : undefined;
}

function parseCount(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined || value.trim() === '') {
    return undefined;
  }
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : undefined;
}

interface HeaderSource {
  get(name: string): string | null;
}

// Liest die x-ratelimit-*-Header einer Groq-Antwort. Fehlen alle, kommt
// undefined zurück, damit der Limiter "nichts bekannt" von "0 übrig"
// unterscheiden kann. Einzelne kaputte Werte fallen einfach weg.
export function parseRateLimitHeaders(
  headers: HeaderSource,
): LlmRateLimit | undefined {
  const rateLimit: LlmRateLimit = {
    remainingTokens: parseCount(headers.get('x-ratelimit-remaining-tokens')),
    resetTokensMs: parseDurationMs(headers.get('x-ratelimit-reset-tokens')),
    remainingRequests: parseCount(
      headers.get('x-ratelimit-remaining-requests'),
    ),
    resetRequestsMs: parseDurationMs(headers.get('x-ratelimit-reset-requests')),
  };
  const known = Object.entries(rateLimit).filter(
    ([, value]) => value !== undefined,
  );
  return known.length ? Object.fromEntries(known) : undefined;
}

import type {
  LlmMessage,
  LlmRateLimit,
  LlmToolDefinition,
} from './llm-provider.interface';

// Längste Pause, die der Limiter VOR einem Aufruf einlegt. Müsste er länger
// warten (Groqs Request-Werte zählen pro Tag, deren Reset liegt Stunden
// entfernt), lässt er den Aufruf direkt durch: Dann greift das bestehende
// 429-Handling (RetryingLlmProvider, run.error quota_exhausted).
export const MAX_THROTTLE_MS = 20_000;

// Grobe Faustregel für englisch/deutsche Texte und JSON: ~4 Zeichen je Token
const CHARS_PER_TOKEN = 4;
// Anteil von maxTokens, der als Ausgabe eingeplant wird. Groq rechnet die
// erzeugten Tokens mit ins Minutenbudget. Den vollen maxTokens-Wert (4096)
// einzuplanen, würde fast jeden Aufruf bremsen, obwohl typische Antworten des
// Agenten ein paar hundert Tokens lang sind.
const OUTPUT_SHARE = 0.25;

export type ThrottleReason = 'tokens' | 'requests';

// Schätzt die Tokens eines Aufrufs, bevor er rausgeht: Zeichen der Nachrichten
// (Text, Tool-Aufrufe, Tool-Ergebnisse) und der Tool-Definitionen geteilt
// durch 4, plus ein Viertel von maxTokens für die Antwort. Bewusst grob: Es
// geht nur darum, ob das Restbudget ungefähr reicht, nicht um Abrechnung.
export function estimateCallTokens(
  messages: LlmMessage[],
  tools: LlmToolDefinition[],
  maxTokens: number,
): number {
  let chars = 0;
  for (const message of messages) {
    chars += message.content?.length ?? 0;
    for (const call of message.toolCalls ?? []) {
      chars += call.name.length + JSON.stringify(call.arguments).length;
    }
    for (const result of message.toolResults ?? []) {
      chars += result.content.length;
    }
  }
  for (const tool of tools) {
    chars +=
      tool.name.length +
      tool.description.length +
      JSON.stringify(tool.parameters).length;
  }
  return (
    Math.ceil(chars / CHARS_PER_TOKEN) + Math.ceil(maxTokens * OUTPUT_SHARE)
  );
}

// Was der Limiter über ein Modell weiß: Restbudget und der absolute Zeitpunkt
// (now()-Zeit), an dem Groq es wieder auffüllt
interface ModelBudget {
  remainingTokens?: number;
  tokensResetAt?: number;
  remainingRequests?: number;
  requestsResetAt?: number;
}

export interface TokenBudgetLimiterOptions {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxWaitMs?: number;
}

// Ampel statt Schranke: Der Limiter blockiert nie endgültig, er schaltet nur
// kurz auf Rot, wenn die letzte Groq-Antwort gesagt hat, dass das Budget für
// den nächsten Aufruf nicht reicht, und wartet bis zum angekündigten Reset.
// Ohne Wissen (erster Aufruf, Anbieter ohne Header) ist immer Grün.
//
// Der Zustand lebt pro Prozess. Mehrere API-Instanzen wissen nichts
// voneinander; jede lernt aber aus den Headern ihrer eigenen Antworten, die
// Groqs Gesamtstand für den Key enthalten.
export class TokenBudgetLimiter {
  private readonly budgets = new Map<string, ModelBudget>();
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly maxWaitMs: number;

  constructor(options: TokenBudgetLimiterOptions = {}) {
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => Date.now());
    this.maxWaitMs = options.maxWaitMs ?? MAX_THROTTLE_MS;
  }

  // Wartet, falls nötig, bis das Budget für estimatedTokens reicht. onWait
  // erfährt die Wartezeit, BEVOR gewartet wird (für die Timeline).
  async acquire(
    model: string,
    estimatedTokens: number,
    onWait?: (waitMs: number, reason: ThrottleReason) => void,
  ): Promise<{ waitedMs: number }> {
    const budget = this.budgets.get(model);
    if (!budget) return { waitedMs: 0 };

    const now = this.now();
    const tokenWait =
      budget.remainingTokens !== undefined &&
      budget.tokensResetAt !== undefined &&
      budget.remainingTokens < estimatedTokens
        ? budget.tokensResetAt - now
        : 0;
    const requestWait =
      budget.remainingRequests !== undefined &&
      budget.requestsResetAt !== undefined &&
      budget.remainingRequests < 1
        ? budget.requestsResetAt - now
        : 0;
    const waitMs = Math.ceil(Math.max(tokenWait, requestWait));

    if (waitMs > 0 && waitMs <= this.maxWaitMs) {
      const reason: ThrottleReason =
        requestWait > tokenWait ? 'requests' : 'tokens';
      onWait?.(waitMs, reason);
      await this.sleep(waitMs);
      // Der Reset ist vorbei: Das Wissen über das alte Fenster ist wertlos,
      // bis die nächste Antwort neue Header bringt.
      this.budgets.delete(model);
      return { waitedMs: waitMs };
    }

    // Grün (oder Wartezeit zu lang, dann soll Groq selbst antworten). Den
    // Aufruf vorab vom bekannten Budget abziehen, damit parallele Läufe auf
    // derselben Instanz nicht alle mit demselben Restbudget rechnen. Die
    // nächste Antwort überschreibt das mit echten Werten.
    if (budget.remainingTokens !== undefined) {
      budget.remainingTokens = Math.max(
        0,
        budget.remainingTokens - estimatedTokens,
      );
    }
    if (budget.remainingRequests !== undefined) {
      budget.remainingRequests = Math.max(0, budget.remainingRequests - 1);
    }
    return { waitedMs: 0 };
  }

  // Übernimmt den Stand aus der letzten Antwort. Werte, die fehlen, behalten
  // ihren bisherigen Stand nicht: Eine Antwort ohne Header löscht das Wissen,
  // statt veraltete Zahlen weiterzutragen.
  update(model: string, rateLimit: LlmRateLimit | undefined): void {
    if (!rateLimit) {
      this.budgets.delete(model);
      return;
    }
    const now = this.now();
    this.budgets.set(model, {
      remainingTokens: rateLimit.remainingTokens,
      tokensResetAt:
        rateLimit.resetTokensMs !== undefined
          ? now + rateLimit.resetTokensMs
          : undefined,
      remainingRequests: rateLimit.remainingRequests,
      requestsResetAt:
        rateLimit.resetRequestsMs !== undefined
          ? now + rateLimit.resetRequestsMs
          : undefined,
    });
  }
}

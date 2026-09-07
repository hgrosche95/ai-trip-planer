const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b';

// Bewusst per Env abschaltbar (Default: aus) - jeder Judge-Aufruf ist ein
// zusätzlicher, ratenlimitierter LLM-Aufruf (Groq Free Tier, siehe
// Phase 1.3) und subjektiver als die harten Retrieval-/Tool-Metriken.
export const JUDGE_ENABLED = process.env.EVAL_JUDGE_ENABLED === 'true';

interface GroqChatCompletion {
  choices: { message: { content: string | null } }[];
}

/**
 * Lässt Groq die Antwort des Agenten auf einer 1-5-Skala bewerten: Beantwortet
 * sie die Frage korrekt und erkennbar belegt durch das erwartete
 * Quelldokument? Gibt null zurück, wenn sich aus der Modellantwort keine
 * gültige Zahl extrahieren lässt, statt eine falsche Zahl zu raten.
 */
export async function judgeAnswer(
  question: string,
  expectedDocument: string,
  reply: string,
): Promise<number | null> {
  if (!GROQ_API_KEY) {
    throw new Error(
      'EVAL_JUDGE_ENABLED=true, aber GROQ_API_KEY ist nicht gesetzt (siehe evals/README.md).',
    );
  }

  const prompt = `Frage: ${question}
Erwartetes Quelldokument: ${expectedDocument}
Antwort des Agenten: ${reply}

Bewerte auf einer Skala von 1 (falsch oder nicht belegt) bis 5 (korrekt und erkennbar mit dem erwarteten Dokument belegt), wie gut die Antwort die Frage beantwortet. Antworte NUR mit der Ziffer, ohne weiteren Text.`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      // gpt-oss-120b ist ein Reasoning-Modell: es verbraucht einen Teil des
      // completion-Budgets für internes "Nachdenken" (message.reasoning),
      // bevor die eigentliche Antwort in message.content landet. Bei einem
      // zu kleinen max_completion_tokens (getestet: 8, 16, 64) bricht es
      // mitten im Reasoning ab (finish_reason "length") und content bleibt
      // leer. reasoning_effort "low" drückt das Reasoning auf ca. 60-70
      // Token (statt ~200 im Default), 200 Token Budget lassen danach noch
      // Platz für die Antwortziffer.
      max_completion_tokens: 200,
      reasoning_effort: 'low',
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) {
    throw new Error(`LLM-as-Judge-Aufruf fehlgeschlagen: HTTP ${response.status}`);
  }

  const data = (await response.json()) as GroqChatCompletion;
  const text = data.choices[0]?.message.content ?? '';
  const match = text.trim().match(/[1-5]/);
  return match ? Number(match[0]) : null;
}

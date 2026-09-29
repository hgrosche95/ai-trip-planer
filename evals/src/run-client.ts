import { authToken } from './agent-client.js';
import type { RunCapture, RunEvent } from './scenario-types.js';

const API_BASE_URL = process.env.TRIP_PLANNER_API_URL ?? 'http://localhost:3000';
// Länger als RUN_TIMEOUT_MS der API (120 s): Der Server bricht selbst ab
// und schickt run.error, das soll hier ankommen
const RUN_TIMEOUT_MS = Number(process.env.EVAL_RUN_TIMEOUT_MS ?? 180_000);

// Ein Lauf über POST /agent/runs im Multi-Agenten-Modus, wie das Frontend
// ihn startet: SSE in derselben Antwort, alle Ereignisse gesammelt.
export async function runMulti(sessionId: string, message: string): Promise<RunCapture> {
  const token = await authToken();
  const startedAt = performance.now();
  const response = await fetch(`${API_BASE_URL}/agent/runs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ sessionId, message, mode: 'multi' }),
    signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
  });
  if (!response.ok || !response.body) {
    throw new Error(`POST /agent/runs fehlgeschlagen (HTTP ${response.status})`);
  }
  const events: RunEvent[] = [];
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const event = parseSseBlock(block);
      if (event) events.push(event);
    }
  }
  const last = parseSseBlock(buffer);
  if (last) events.push(last);
  return { message, events, wallMs: Math.round(performance.now() - startedAt) };
}

// Ein SSE-Block: Kommentare (": ping") und event:/id:-Zeilen überspringen,
// data: enthält das ganze Ereignis als JSON
export function parseSseBlock(block: string): RunEvent | null {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (data === '') return null;
  return JSON.parse(data) as RunEvent;
}

const API_BASE_URL = process.env.TRIP_PLANNER_API_URL ?? 'http://localhost:3000';
const USERNAME = process.env.TRIP_PLANNER_USERNAME;
const PASSWORD = process.env.TRIP_PLANNER_PASSWORD;

interface ChatResponse {
  reply: string;
  searchAttempted: boolean;
}

// Gleiches Login-Prinzip wie packages/mcp-server/src/api-client.ts: einmal
// pro Prozesslauf einloggen und den Token cachen, statt vor jeder Frage neu
// zu authentifizieren.
let cachedToken: string | null = null;

async function login(): Promise<string> {
  if (!USERNAME || !PASSWORD) {
    throw new Error(
      'TRIP_PLANNER_USERNAME/TRIP_PLANNER_PASSWORD sind nicht gesetzt (siehe evals/README.md).',
    );
  }
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (!response.ok) {
    throw new Error(
      `Login gegen ${API_BASE_URL}/auth/login fehlgeschlagen: HTTP ${response.status}`,
    );
  }
  const data = (await response.json()) as { accessToken: string };
  return data.accessToken;
}

export async function chat(
  sessionId: string,
  message: string,
): Promise<ChatResponse> {
  cachedToken ??= await login();
  const response = await fetch(`${API_BASE_URL}/agent/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cachedToken}`,
    },
    body: JSON.stringify({ sessionId, message }),
  });
  if (!response.ok) {
    throw new Error(
      `POST /agent/chat fehlgeschlagen (HTTP ${response.status}) für Session ${sessionId}`,
    );
  }
  return response.json() as Promise<ChatResponse>;
}

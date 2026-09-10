const API_BASE_URL = process.env.TRIP_PLANNER_API_URL ?? 'http://localhost:3000';
const USERNAME = process.env.TRIP_PLANNER_USERNAME;
const PASSWORD = process.env.TRIP_PLANNER_PASSWORD;

export interface CreateItineraryInput {
  destination: string;
  startDate: string;
  endDate: string;
  budgetCents: number;
  currency?: string;
  preferences?: string[];
  stops: {
    dayNumber: number;
    order: number;
    title: string;
    description?: string;
    category?:
      | 'FOOD'
      | 'CULTURE'
      | 'SIGHTSEEING'
      | 'ACCOMMODATION'
      | 'TRANSPORT'
      | 'OTHER';
    costCents?: number;
  }[];
}

// Im Speicher gehalten statt in einer Datei/Umgebungsvariable: der
// MCP-Server läuft als kurzlebiger Kindprozess pro Client-Sitzung (stdio),
// ein Neustart loggt einfach neu ein - kein Bedarf für Persistenz über
// Prozessgrenzen hinweg.
let cachedToken: string | null = null;

async function login(): Promise<string> {
  if (!USERNAME || !PASSWORD) {
    throw new Error(
      'TRIP_PLANNER_USERNAME/TRIP_PLANNER_PASSWORD sind nicht gesetzt (siehe README).',
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

async function authenticatedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  cachedToken ??= await login();

  const request = () =>
    fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${cachedToken}`,
        'Content-Type': 'application/json',
      },
    });

  let response = await request();
  if (response.status === 401) {
    // Token evtl. abgelaufen oder ungültig geworden - einmal neu einloggen
    // und erneut versuchen, statt sofort aufzugeben.
    cachedToken = await login();
    response = await request();
  }
  return response;
}

export async function listItineraries(): Promise<unknown> {
  const response = await authenticatedFetch('/itineraries');
  if (!response.ok) {
    throw new Error(`GET /itineraries fehlgeschlagen: HTTP ${response.status}`);
  }
  return response.json();
}

export async function createItinerary(
  input: CreateItineraryInput,
): Promise<unknown> {
  const response = await authenticatedFetch('/itineraries', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `POST /itineraries fehlgeschlagen: HTTP ${response.status} - ${body}`,
    );
  }
  return response.json();
}

export async function searchTravelKnowledge(query: string): Promise<unknown> {
  const response = await authenticatedFetch('/knowledge/search', {
    method: 'POST',
    body: JSON.stringify({ query }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `POST /knowledge/search fehlgeschlagen: HTTP ${response.status} - ${body}`,
    );
  }
  return response.json();
}

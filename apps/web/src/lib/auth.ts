const TOKEN_KEY = 'auth_token';
const API_URL = process.env.NEXT_PUBLIC_API_URL;

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// Mehrere Komponenten rufen beim ersten Laden gleichzeitig authFetch auf.
// Ohne das gemeinsame Promise würde jede davon ein eigenes Gastkonto anlegen.
let guestTokenPromise: Promise<string> | null = null;

function fetchGuestToken(): Promise<string> {
  guestTokenPromise ??= (async () => {
    const response = await fetch(`${API_URL}/auth/guest`, { method: 'POST' });
    if (!response.ok) {
      throw new Error(`Gastzugang fehlgeschlagen: HTTP ${response.status}`);
    }
    const { accessToken } = (await response.json()) as { accessToken: string };
    setToken(accessToken);
    return accessToken;
  })().finally(() => {
    guestTokenPromise = null;
  });
  return guestTokenPromise;
}

// Jeder Besucher braucht ein Token, weil die API Reisepläne pro Nutzer
// trennt. Wer nicht eingeloggt ist, bekommt automatisch ein Gast-Token;
// die Pläne hängen dann an diesem Browser.
export async function authFetch(input: string, init: RequestInit = {}) {
  const send = (token: string) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };

  const response = await send(getToken() ?? (await fetchGuestToken()));
  if (response.status !== 401) return response;

  // Abgelaufenes oder veraltetes Token: einmal mit frischem Gast-Token
  // wiederholen, statt auf die Login-Seite zu schicken (die ist nur für den
  // Besitzer da).
  clearToken();
  return send(await fetchGuestToken());
}

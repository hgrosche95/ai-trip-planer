import type { AgentMode } from './run-events';

// Umschalter im Chat: welcher Modus POST /agent/runs beantworten soll. Die
// Wahl gilt pro Browser und geht mit jeder Anfrage als mode mit. Ob der
// Server sie übernimmt, entscheidet er (AGENT_MODE_LOCKED); run.started
// meldet den tatsächlich genutzten Modus.

export const DEFAULT_AGENT_MODE: AgentMode = 'multi';

export const AGENT_MODE_OPTIONS: { mode: AgentMode; label: string; detail: string }[] = [
  { mode: 'classic', label: 'Klassisch', detail: 'ein Agent' },
  { mode: 'multi', label: 'Multi-Agent', detail: 'Planer, Recherche, Budget' },
];

// Kurzname für die Ablauf-Zeile unter einer Antwort
export const AGENT_MODE_LABELS: Record<AgentMode, string> = {
  classic: 'Klassisch',
  multi: 'Multi-Agent',
};

const STORAGE_KEY = 'trip-planner.agent-mode';

export function parseAgentMode(value: unknown): AgentMode | undefined {
  return value === 'classic' || value === 'multi' ? value : undefined;
}

// localStorage kann fehlen oder werfen (privater Modus, gesperrte Website-
// Daten, statisches Rendern). Dann gilt die Wahl nur bis zum Neuladen (im
// Arbeitsspeicher), vorher der Default.
let unsavedMode: AgentMode | undefined;
const listeners = new Set<() => void>();

export function readStoredAgentMode(storage?: Pick<Storage, 'getItem'>): AgentMode {
  try {
    const store = storage ?? globalThis.localStorage;
    if (!store) return unsavedMode ?? DEFAULT_AGENT_MODE;
    return parseAgentMode(store.getItem(STORAGE_KEY)) ?? unsavedMode ?? DEFAULT_AGENT_MODE;
  } catch {
    return unsavedMode ?? DEFAULT_AGENT_MODE;
  }
}

export function storeAgentMode(mode: AgentMode, storage?: Pick<Storage, 'setItem'>): void {
  unsavedMode = mode;
  try {
    (storage ?? globalThis.localStorage)?.setItem(STORAGE_KEY, mode);
  } catch {
    // Bleibt in unsavedMode, bis die Seite neu geladen wird
  }
  listeners.forEach((listener) => listener());
}

// Für useSyncExternalStore: reagiert auf eigene Änderungen und auf andere Tabs
export function subscribeAgentMode(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  globalThis.addEventListener?.('storage', onStorage);
  return () => {
    listeners.delete(listener);
    globalThis.removeEventListener?.('storage', onStorage);
  };
}

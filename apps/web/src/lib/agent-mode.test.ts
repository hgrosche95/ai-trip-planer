import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_AGENT_MODE,
  parseAgentMode,
  readStoredAgentMode,
  storeAgentMode,
  subscribeAgentMode,
} from './agent-mode.ts';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const broken = {
  getItem: (): string | null => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

// Reihenfolge wichtig: das Modul merkt sich die letzte Wahl im Arbeitsspeicher
test('Default ist multi, auch wenn der Speicher leer ist oder wirft', () => {
  assert.equal(DEFAULT_AGENT_MODE, 'multi');
  assert.equal(readStoredAgentMode(memoryStorage()), 'multi');
  assert.equal(readStoredAgentMode(broken), 'multi');
});

test('merkt sich die Wahl und liest sie wieder', () => {
  const storage = memoryStorage();
  storeAgentMode('classic', storage);
  assert.equal(readStoredAgentMode(storage), 'classic');
  storeAgentMode('multi', storage);
  assert.equal(readStoredAgentMode(storage), 'multi');
});

test('unbekannte Werte im Speicher gelten nicht', () => {
  const storage = memoryStorage();
  storage.setItem('trip-planner.agent-mode', 'swarm');
  assert.equal(readStoredAgentMode(storage), 'multi');
  assert.equal(parseAgentMode('swarm'), undefined);
  assert.equal(parseAgentMode('classic'), 'classic');
});

test('ohne nutzbaren Speicher gilt die Wahl bis zum Neuladen', () => {
  assert.doesNotThrow(() => storeAgentMode('classic', broken));
  assert.equal(readStoredAgentMode(broken), 'classic');
});

test('benachrichtigt Abonnenten beim Speichern', () => {
  let calls = 0;
  const unsubscribe = subscribeAgentMode(() => calls++);
  storeAgentMode('classic', memoryStorage());
  unsubscribe();
  storeAgentMode('multi', memoryStorage());
  assert.equal(calls, 1);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearChatSession, readChatSession, writeChatSession } from './chat-session.ts';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

const broken = {
  getItem: (): string | null => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

test('Chat übersteht Schreiben und Lesen samt gespeicherter Entwürfe', () => {
  const storage = memoryStorage();
  const session = {
    sessionId: 'abc',
    messages: [{ role: 'user', content: '3 Tage Lissabon' }],
    saved: { 1: 'trip-1' },
  };
  writeChatSession(session, storage);
  assert.deepEqual(readChatSession(storage), session);
});

test('Leerer, kaputter oder fremder Inhalt ergibt keinen Chat', () => {
  const storage = memoryStorage();
  assert.equal(readChatSession(storage), null);
  storage.setItem('trip-planner.chat-session', '{nicht json');
  assert.equal(readChatSession(storage), null);
  storage.setItem('trip-planner.chat-session', JSON.stringify({ sessionId: 1, messages: [] }));
  assert.equal(readChatSession(storage), null);
});

test('Fehlt saved (ältere Sicherung), gilt ein leeres Objekt', () => {
  const storage = memoryStorage();
  storage.setItem('trip-planner.chat-session', JSON.stringify({ sessionId: 'x', messages: [] }));
  assert.deepEqual(readChatSession(storage), { sessionId: 'x', messages: [], saved: {} });
});

test('Clear entfernt die Sicherung', () => {
  const storage = memoryStorage();
  writeChatSession({ sessionId: 'x', messages: [], saved: {} }, storage);
  clearChatSession(storage);
  assert.equal(readChatSession(storage), null);
});

test('Ein werfender Speicher bricht nichts', () => {
  assert.equal(readChatSession(broken), null);
  assert.doesNotThrow(() => writeChatSession({ sessionId: 'x', messages: [], saved: {} }, broken));
  assert.doesNotThrow(() => clearChatSession(broken));
});

// Chat und Entwürfe überleben Neuladen und den Weg über "Meine Reisen" und
// zurück: Der Stand liegt pro Tab im sessionStorage. Ein neuer Tab oder
// "Neue Reise" beginnt leer. Wie bei agent-mode.ts kann der Speicher fehlen
// oder werfen (privater Modus, volles Kontingent), dann gilt nur der
// Arbeitsspeicher und nichts bricht.

const STORAGE_KEY = 'trip-planner.chat-session';

export interface StoredChatSession<Message> {
  sessionId: string;
  messages: Message[];
  // Gespeicherte Entwürfe: Index der Antwort im Chat -> ID der Reise
  saved: Record<number, string>;
}

export function readChatSession<Message>(
  storage?: Pick<Storage, 'getItem'>,
): StoredChatSession<Message> | null {
  try {
    const raw = (storage ?? globalThis.sessionStorage)?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as StoredChatSession<Message>).sessionId !== 'string' ||
      !Array.isArray((parsed as StoredChatSession<Message>).messages)
    ) {
      return null;
    }
    const session = parsed as StoredChatSession<Message>;
    const saved = typeof session.saved === 'object' && session.saved !== null ? session.saved : {};
    return { sessionId: session.sessionId, messages: session.messages, saved };
  } catch {
    return null;
  }
}

export function writeChatSession<Message>(
  session: StoredChatSession<Message>,
  storage?: Pick<Storage, 'setItem'>,
): void {
  try {
    (storage ?? globalThis.sessionStorage)?.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Kontingent voll oder Speicher gesperrt: Der Chat läuft ohne Sicherung weiter
  }
}

export function clearChatSession(storage?: Pick<Storage, 'removeItem'>): void {
  try {
    (storage ?? globalThis.sessionStorage)?.removeItem(STORAGE_KEY);
  } catch {
    // Nichts zu tun
  }
}

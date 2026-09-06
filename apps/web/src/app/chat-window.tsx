'use client';

import { useState } from 'react';
import { authFetch } from '@/lib/auth';

interface ChatSource {
  title: string;
  source: string;
  license: string;
  url: string | null;
  score: number;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
  searchAttempted?: boolean;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL;

function SourcesPanel({ sources, searchAttempted }: { sources?: ChatSource[]; searchAttempted?: boolean }) {
  if (sources && sources.length > 0) {
    return (
      <details className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
        <summary className="cursor-pointer select-none text-zinc-500">
          Quellen ({sources.length})
        </summary>
        <ul className="mt-1 space-y-1 border-l-2 border-zinc-300 pl-2 dark:border-zinc-700">
          {sources.map((source, index) => (
            <li key={index}>
              <span className="font-medium">{source.title}</span>
              {' – '}
              {source.source} · {source.license} ·{' '}
              {Math.round(source.score * 100)}% Relevanz
              {source.url && (
                <>
                  {' · '}
                  <a href={source.url} target="_blank" rel="noreferrer" className="underline">
                    Link
                  </a>
                </>
              )}
            </li>
          ))}
        </ul>
      </details>
    );
  }

  if (searchAttempted) {
    return (
      <p className="mt-1 text-xs text-amber-700 dark:text-amber-500">
        Keine passende Quelle in der Wissensbasis gefunden.
      </p>
    );
  }

  return null;
}

export default function ChatWindow() {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const userMessage = input.trim();
    if (!userMessage) return;

    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setInput('');
    setIsLoading(true);

    const response = await authFetch(`${API_URL}/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message: userMessage }),
    });
    const data = await response.json();

    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: data.reply,
        sources: data.sources,
        searchAttempted: data.searchAttempted,
      },
    ]);
    setIsLoading(false);
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col p-4">
      <div className="mb-4 flex-1 space-y-3 overflow-y-auto">
        {messages.map((message, index) => (
          <div key={index} className={message.role === 'user' ? 'text-right' : 'text-left'}>
            <span
              className={
                'inline-block rounded-lg px-4 py-2 whitespace-pre-wrap ' +
                (message.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-200 dark:bg-zinc-800')
              }
            >
              {message.content}
            </span>
            {message.role === 'assistant' && (
              <SourcesPanel sources={message.sources} searchAttempted={message.searchAttempted} />
            )}
          </div>
        ))}
        {isLoading && <p className="text-sm text-zinc-500">Claude denkt nach...</p>}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Beschreib deine Reisewünsche..."
          className="flex-1 rounded-lg border px-4 py-2"
        />
        <button
          type="submit"
          disabled={isLoading}
          className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          Senden
        </button>
      </form>
    </div>
  );
}

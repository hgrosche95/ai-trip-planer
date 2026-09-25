'use client';

import { useState } from 'react';
import Markdown, { type Components } from 'react-markdown';
import { authFetch } from '@/lib/auth';
import Spinner from '@/components/spinner';

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

const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
  h1: ({ children }) => <h3 className="mb-1 mt-3 font-extrabold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-1 mt-3 font-extrabold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h3 className="mb-1 mt-3 font-extrabold first:mt-0">{children}</h3>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-teal underline dark:text-teal-300"
    >
      {children}
    </a>
  ),
};

function SourcesPanel({ sources, searchAttempted }: { sources?: ChatSource[]; searchAttempted?: boolean }) {
  if (sources && sources.length > 0) {
    return (
      <ul aria-label={`Quellen (${sources.length})`} className="mt-3 flex flex-wrap gap-1.5">
        {sources.map((source, index) => {
          const label = `${source.title} · ${source.license} · ${Math.round(source.score * 100)}%`;
          const chipClass =
            'rounded border border-dashed border-teal bg-teal/5 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-teal dark:border-teal-300 dark:text-teal-300';

          return (
            <li key={index}>
              {source.url ? (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  title={source.source}
                  className={chipClass + ' block hover:bg-teal/15'}
                >
                  {label}
                </a>
              ) : (
                <span title={source.source} className={chipClass + ' block'}>
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  if (searchAttempted) {
    return (
      <p className="mt-2 text-xs text-amber-700 dark:text-amber-500">
        Keine passende Quelle in der Wissensbasis gefunden.
      </p>
    );
  }

  return null;
}

const EXAMPLE_PROMPTS = [
  { tag: 'Städtetrip', text: '3 Tage Lissabon im Oktober, Budget 800 €' },
  { tag: 'Natur', text: 'Eine Woche Wandern in den Dolomiten im Juni' },
  { tag: 'Kulinarik', text: 'Ein Wochenende Street Food in Krakau' },
  { tag: 'Budget', text: 'Günstige Ostsee-Ziele, Anreise mit dem Zug' },
];

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-5 py-8">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-dim">Neue Reise</p>
        <h1 className="mt-1 text-3xl font-extrabold text-balance">
          Wohin soll&apos;s als Nächstes gehen?
        </h1>
        <p className="mt-2 text-sm text-dim">
          Beschreib Ziel, Zeitraum und Budget. Ich plane Tag für Tag und zeige dir, aus welchen
          Quellen meine Infos stammen.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {EXAMPLE_PROMPTS.map((prompt) => (
          <button
            key={prompt.text}
            type="button"
            onClick={() => onPick(prompt.text)}
            className="rounded-xl border border-rule bg-card p-3 text-left text-sm transition hover:border-teal focus-visible:outline-2 focus-visible:outline-teal"
          >
            <span className="block font-mono text-[10px] uppercase tracking-widest text-teal dark:text-teal-300">
              {prompt.tag}
            </span>
            {prompt.text}
          </button>
        ))}
      </div>
    </div>
  );
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
      <div className="mb-4 flex flex-1 flex-col gap-4 overflow-y-auto">
        {messages.length === 0 && !isLoading && <EmptyState onPick={setInput} />}

        {messages.map((message, index) =>
          message.role === 'user' ? (
            <div key={index} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-navy px-4 py-2 text-white dark:bg-teal">
                {message.content}
              </p>
            </div>
          ) : (
            <div key={index} className="max-w-[92%]">
              <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-dim">
                KI-Planer
              </p>
              <div className="rounded-2xl rounded-tl-sm border border-rule bg-card px-4 py-3">
                <Markdown components={MARKDOWN_COMPONENTS}>{message.content}</Markdown>
                <SourcesPanel sources={message.sources} searchAttempted={message.searchAttempted} />
              </div>
            </div>
          ),
        )}

        {isLoading && (
          <p className="flex items-center gap-2 text-sm font-semibold text-teal dark:text-teal-300">
            <Spinner />
            Plant deine Reise…
          </p>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex gap-2 rounded-xl border border-rule bg-card p-2 focus-within:border-teal"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Beschreib deine Reisewünsche..."
          className="flex-1 bg-transparent px-2 py-1.5 outline-none placeholder:text-dim"
        />
        <button
          type="submit"
          disabled={isLoading}
          className="rounded-lg bg-stamp px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          Senden
        </button>
      </form>
    </div>
  );
}

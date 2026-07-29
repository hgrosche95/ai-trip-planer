'use client';

import { useState } from 'react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL;

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

    const response = await fetch(`${API_URL}/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message: userMessage }),
    });
    const data = await response.json();

    setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
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
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { setToken } from '@/lib/auth';
import Spinner from '@/components/spinner';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);

    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      setError('Login fehlgeschlagen.');
      setIsLoading(false);
      return;
    }

    const data = await response.json();
    setToken(data.accessToken);
    router.push('/');
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center p-4">
      <h1 className="mb-4 text-xl font-semibold">Login</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          className="rounded-lg border px-4 py-2"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Passwort"
          className="rounded-lg border px-4 py-2"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={isLoading}
          className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {isLoading && <Spinner />}
          {isLoading ? 'Melde an…' : 'Einloggen'}
        </button>
        {isLoading && (
          <p className="text-center text-xs text-zinc-500">
            Das kann nach einer Ruhephase der Demo etwas dauern (Server startet neu).
          </p>
        )}
      </form>
    </div>
  );
}

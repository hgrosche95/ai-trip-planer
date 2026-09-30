'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { setToken } from '@/lib/auth';
import Spinner from '@/components/spinner';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

const fieldClass =
  'min-h-11 rounded-lg border border-rule bg-card px-3 text-base outline-none focus-visible:border-teal focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--focus)';

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

    let response: Response;
    try {
      response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
    } catch {
      setError('Der Server ist gerade nicht erreichbar. Versuch es bitte gleich noch einmal.');
      setIsLoading(false);
      return;
    }

    if (!response.ok) {
      setError('Benutzername oder Passwort stimmt nicht.');
      setIsLoading(false);
      return;
    }

    const data = await response.json();
    setToken(data.accessToken);
    router.push('/');
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center p-4">
      <h1 className="mb-5 text-2xl font-extrabold">Anmelden</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Benutzername
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Passwort
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className={fieldClass}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-stamp dark:text-red-400">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={isLoading}
          className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-navy px-4 font-semibold text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus) dark:bg-foreground dark:text-background"
        >
          {isLoading && <Spinner />}
          {isLoading ? 'Melde an …' : 'Anmelden'}
        </button>
        {isLoading && (
          <p role="status" className="text-center text-xs text-dim">
            Das kann nach einer Ruhephase der Demo etwas dauern (Server startet neu).
          </p>
        )}
      </form>
    </div>
  );
}

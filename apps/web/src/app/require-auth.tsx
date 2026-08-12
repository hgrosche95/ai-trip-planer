'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';

// Der Token ändert sich nie, während RequireAuth gemountet ist (Login/Logout
// gehen über einen vollen Redirect) - subscribe() muss daher nie feuern.
function subscribe() {
  return () => {};
}

function getServerSnapshot() {
  return false;
}

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const hasToken = useSyncExternalStore(subscribe, () => !!getToken(), getServerSnapshot);

  useEffect(() => {
    if (!hasToken) {
      router.replace('/login');
    }
  }, [hasToken, router]);

  if (!hasToken) return null;
  return <>{children}</>;
}

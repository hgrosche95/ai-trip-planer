'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  // Bewusst kein useSyncExternalStore mit getServerSnapshot: dessen erster Render
  // liefert beim Hydrieren immer false (kein window server-seitig), der Effekt aus
  // genau diesem Render feuert dann router.replace('/login') - eine asynchrone
  // Navigation, die auch bei einem eingeloggten Nutzer nicht mehr storniert wird,
  // selbst wenn direkt danach mit dem echten Token-Wert neu gerendert wird. Der
  // Lazy-useState-Initializer läuft dagegen genau einmal, mit dem echten
  // Browser-Zustand - kostet nur eine harmlose Hydration-Mismatch-Warnung in der
  // Konsole (kein window beim serverseitigen Render vs. echter Wert beim Client-Render).
  const [hasToken] = useState(() => !!getToken());

  useEffect(() => {
    if (!hasToken) {
      router.replace('/login');
    }
  }, [hasToken, router]);

  if (!hasToken) return null;
  return <>{children}</>;
}

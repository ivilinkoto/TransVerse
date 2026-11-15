'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/** Tells the server which page of the game was opened (counted once per player and day, for the team). */
export function PageVisit() {
  const pathname = usePathname();
  useEffect(() => {
    void fetch('/api/game/visit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: pathname }), keepalive: true }).catch(() => {});
  }, [pathname]);
  return null;
}

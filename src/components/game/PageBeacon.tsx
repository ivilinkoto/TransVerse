'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/** 1.2.1.1: tells the server which game page was opened (no content, only the path). */
export function PageBeacon() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname) return;
    const id = setTimeout(() => {
      void fetch('/api/game/view', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: pathname }), keepalive: true }).catch(() => {});
    }, 400);
    return () => clearTimeout(id);
  }, [pathname]);
  return null;
}

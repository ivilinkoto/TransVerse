'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

/** Listens to server events and refreshes server-rendered data (debounced). */
export function LiveUpdates() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const source = new EventSource('/api/events');
    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as { type: string };
      if (data.type === 'hello') return;
      // Other players' trucks only matter to the map, which reloads them itself.
      if (data.type === 'world') {
        window.dispatchEvent(new Event('tv:world'));
        return;
      }
      // Company chat reloads itself; other pages are not refreshed.
      if (data.type === 'chat') {
        window.dispatchEvent(new Event('tv:chat'));
        return;
      }
      clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 600);
    };
    // Deliveries also finish by time alone — refresh once a minute as a safety net.
    const interval = setInterval(() => router.refresh(), 60_000);
    return () => {
      source.close();
      clearInterval(interval);
      clearTimeout(timer.current);
    };
  }, [router]);
  return null;
}

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { playChime, soundEnabled, unlockSound } from '@/lib/client/sound';

/** Listens to server events and refreshes server-rendered data (debounced). */
export function LiveUpdates() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    // Sound needs one user gesture before the browser allows it.
    window.addEventListener('pointerdown', unlockSound, { once: true });
    window.addEventListener('keydown', unlockSound, { once: true });
    const source = new EventSource('/api/events');
    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as { type: string; channel?: string; with?: string };
      if (data.type === 'hello') return;
      // Other players' trucks only matter to the map, which reloads them itself.
      if (data.type === 'world') {
        window.dispatchEvent(new Event('tv:world'));
        return;
      }
      // World chat and private messages: the chat dock reloads itself.
      if (data.type === 'channel') {
        window.dispatchEvent(new CustomEvent('tv:channel', { detail: { channel: data.channel } }));
        return;
      }
      if (data.type === 'dm') {
        window.dispatchEvent(new CustomEvent('tv:dm', { detail: { with: data.with } }));
        return;
      }
      // Company chat reloads itself; other pages are not refreshed.
      if (data.type === 'chat') {
        window.dispatchEvent(new Event('tv:chat'));
        return;
      }
      // A new notification for this player: a short chime while the game is in view.
      if (data.type === 'notification' && soundEnabled() && document.visibilityState === 'visible') playChime();
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

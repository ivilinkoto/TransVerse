'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { arrivalSoundEnabled, playArrival, playChime, soundEnabled, unlockSound } from '@/lib/client/sound';
import { useFeature } from '@/components/game/Features';

/** Listens to server events and refreshes server-rendered data (debounced). */
export function LiveUpdates() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // 1.1.3: an arrival has its own sound (and a buzz on phones).
  const arrivalSound = useFeature('arrival_sound');
  const arrival = useRef(arrivalSound);
  useEffect(() => {
    arrival.current = arrivalSound;
  }, [arrivalSound]);
  const last = useRef(0);
  const planned = useRef(0);
  const stale = useRef(false);
  useEffect(() => {
    const refresh = () => {
      clearTimeout(timer.current);
      timer.current = undefined;
      last.current = Date.now();
      stale.current = false;
      router.refresh();
    };
    /** Refresh after `ms`; an earlier refresh already planned is kept. */
    const schedule = (ms: number) => {
      const at = Date.now() + ms;
      if (timer.current && planned.current <= at) return;
      clearTimeout(timer.current);
      planned.current = at;
      timer.current = setTimeout(refresh, ms);
    };
    // Sound needs one user gesture before the browser allows it.
    window.addEventListener('pointerdown', unlockSound, { once: true });
    window.addEventListener('keydown', unlockSound, { once: true });
    const source = new EventSource('/api/events');
    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as { type: string; channel?: string; with?: string; sound?: string; kind?: string; title?: string };
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
      // 1.1.4.3: a medal or a delivery gets its effect (FxHost listens).
      if (data.type === 'notification' && document.visibilityState === 'visible' && (data.kind === 'achievement' || data.sound === 'arrival')) {
        window.dispatchEvent(new CustomEvent('tv:fx', { detail: { kind: data.kind, title: data.title, arrival: data.sound === 'arrival' } }));
      }
      // A new notification for this player: a short chime while the game is in view.
      if (data.type === 'notification' && soundEnabled() && document.visibilityState === 'visible') {
        if (data.sound === 'arrival' && arrival.current) {
          if (arrivalSoundEnabled()) playArrival();
        } else playChime();
      }
      // The player's own news shows soon; changes of the market or the rankings (every other
      // player's trip) at most every 20 s, spread out, and only in a tab that is in view — every
      // open tab of every player rendering its page again on each truck overloaded the server.
      const own = data.type === 'notification';
      if (document.hidden) {
        stale.current = true;
        return;
      }
      schedule(own ? 800 : Math.max(0, last.current + 20_000 - Date.now()) + Math.random() * 5_000);
    };
    // Deliveries also finish by time alone — refresh once a minute as a safety net (in view only).
    const interval = setInterval(() => {
      if (document.hidden) stale.current = true;
      else refresh();
    }, 60_000);
    const shown = () => {
      if (!document.hidden && stale.current) schedule(500);
    };
    document.addEventListener('visibilitychange', shown);
    return () => {
      source.close();
      clearInterval(interval);
      clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', shown);
    };
  }, [router]);
  return null;
}

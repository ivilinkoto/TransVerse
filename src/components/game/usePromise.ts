'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { PROMISES, type PromiseId } from '@/lib/game/promise';

/**
 * 1.1.4.2: the deadline the player promises on every load, remembered in this
 * browser (a convenience; the server records the promise of each trip).
 */
const KEY = 'tv:promise';
const listeners = new Set<() => void>();

function read(): PromiseId {
  try {
    const v = localStorage.getItem(KEY);
    return v && v in PROMISES ? (v as PromiseId) : 'normal';
  } catch {
    return 'normal';
  }
}

export function usePromise(): [PromiseId, (p: PromiseId) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => 'normal' as PromiseId,
  );
  const set = useCallback((p: PromiseId) => {
    try {
      localStorage.setItem(KEY, p);
    } catch {
      /* storage unavailable: the choice lasts until the page reloads */
    }
    listeners.forEach((l) => l());
  }, []);
  return [value, set];
}

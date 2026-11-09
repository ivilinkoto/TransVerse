'use client';

import { useEffect } from 'react';
import { api } from '@/lib/client/api';

/** 1.2.3.6: opening the letters marks them read (after a moment, so the new ones are still highlighted). */
export function MarkLettersRead() {
  useEffect(() => {
    const id = setTimeout(() => void api('/api/game/action', { type: 'readLetters' }).catch(() => undefined), 1500);
    return () => clearTimeout(id);
  }, []);
  return null;
}

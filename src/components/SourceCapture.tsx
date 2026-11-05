'use client';

import { useEffect } from 'react';
import { normalizeSource, SOURCE_COOKIE, SOURCE_DAYS } from '@/lib/game/signup-source';

/** 1.2.4: remembers the `?src=` of the first visit (first touch wins) for the sign-up. */
export function SourceCapture() {
  useEffect(() => {
    try {
      const src = normalizeSource(new URLSearchParams(window.location.search).get('src'));
      if (!src || document.cookie.split('; ').some((c) => c.startsWith(`${SOURCE_COOKIE}=`))) return;
      document.cookie = `${SOURCE_COOKIE}=${encodeURIComponent(src)}; max-age=${SOURCE_DAYS * 86_400}; path=/; samesite=lax`;
    } catch {
      // Cookies blocked: the source is simply unknown.
    }
  }, []);
  return null;
}

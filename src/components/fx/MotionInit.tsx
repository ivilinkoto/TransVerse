'use client';

import { useEffect } from 'react';
import { applyMotion } from '@/lib/client/motion';

/** 1.1.4.3: marks the page with the animation setting of this device. */
export function MotionInit() {
  useEffect(() => {
    applyMotion();
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    mq?.addEventListener?.('change', applyMotion);
    return () => mq?.removeEventListener?.('change', applyMotion);
  }, []);
  return null;
}

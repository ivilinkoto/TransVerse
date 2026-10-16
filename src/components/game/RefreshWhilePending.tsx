'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Re-checks the page every few seconds (up to two minutes) while a payment is being confirmed. */
export function RefreshWhilePending() {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const timer = setInterval(() => {
      if (++n > 40) return clearInterval(timer);
      router.refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}

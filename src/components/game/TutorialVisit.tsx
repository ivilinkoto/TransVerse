'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { api } from '@/lib/client/api';

/** Marks a "visit this page" tutorial step as done when the page is opened. */
export function TutorialVisit({ step, pending }: { step: string; pending: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!pending) return;
    api('/api/game/action', { type: 'tutorialStep', step })
      .then(() => router.refresh())
      .catch(() => {});
  }, [pending, step, router]);
  return null;
}

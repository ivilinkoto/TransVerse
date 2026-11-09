'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { GameWindow } from './GameWindow';

/**
 * 1.2.3.6: a page opened as a game window over the current page (an intercepted route).
 * Closing goes back to the page underneath. Without „Нов облик“ the full page loads instead.
 */
export function RouteWindow({ title, icon, live, href, size = 'lg', testId, children }: { title: string; icon?: ReactNode; live: boolean; href: string; size?: 'sm' | 'md' | 'lg' | 'xl'; testId?: string; children: ReactNode }) {
  const router = useRouter();
  useEffect(() => {
    if (!live) window.location.assign(href);
  }, [live, href]);
  if (!live) return null;
  return (
    <GameWindow title={title} icon={icon} size={size} testId={testId} onClose={() => router.back()}>
      {children}
    </GameWindow>
  );
}

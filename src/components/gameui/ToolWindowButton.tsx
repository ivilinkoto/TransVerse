'use client';

import { useState, type ReactNode } from 'react';
import { GameWindow } from './GameWindow';
import { playSelect } from '@/lib/client/motion';

/**
 * 1.3 „Нов облик“: a game tool as one big button (an icon, a label, a counter) that
 * opens its panel in a game window — instead of a row of panels on the page.
 */
export function ToolWindowButton({ icon, label, hint, badge, accent = '#22d3ee', title, children, testId }: { icon: string; label: string; hint?: string; badge?: string | null; accent?: string; title: string; children: ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => (playSelect(), setOpen(true))} className="tool-tile relative flex items-center gap-3 rounded-2xl p-3 text-left" style={{ '--tile': accent } as React.CSSProperties} data-testid={testId}>
        <span className="tool-tile-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl" aria-hidden>{icon}</span>
        <span className="min-w-0">
          <span className="block font-display text-sm font-bold text-white">{label}</span>
          {hint && <span className="block truncate text-[11px] text-mist-400">{hint}</span>}
        </span>
        {badge && <span className="dash-tile-badge num absolute right-2 top-2 rounded-full px-1.5 text-[10px] font-bold">{badge}</span>}
      </button>
      {open && (
        <GameWindow title={title} icon={icon} accent={accent} size="lg" onClose={() => setOpen(false)} testId={testId ? `${testId}-window` : undefined}>
          {children}
        </GameWindow>
      )}
    </>
  );
}

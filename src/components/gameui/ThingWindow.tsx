'use client';

import { useState, useSyncExternalStore, type ReactNode } from 'react';

const noop = () => () => {};
import { GameWindow } from './GameWindow';
import { playSelect } from '@/lib/client/motion';

export interface ThingSection {
  id: string;
  label: string;
  emoji: string;
  content: ReactNode;
}

/**
 * 1.3.3: one window with everything for one thing (a train, later more) — a
 * button opens it, tabs inside hold what used to be separate pages. The
 * sections are rendered on the server and passed in.
 */
export function ThingWindow({ button, title, icon, accent = '#22d3ee', sections, initialOpen = false, initialTab, testId }: {
  button: ReactNode;
  title: string;
  icon: string;
  accent?: string;
  sections: ThingSection[];
  initialOpen?: boolean;
  initialTab?: string;
  testId?: string;
}) {
  // Opened from a link (?truck= / ?train=): only in the browser, after the first render — the window is a portal to document.body.
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const [chosen, setOpen] = useState<boolean | null>(null);
  const open = chosen ?? (initialOpen && mounted);
  const [tab, setTab] = useState(initialTab && sections.some((s) => s.id === initialTab) ? initialTab : sections[0]?.id);
  const current = sections.find((s) => s.id === tab) ?? sections[0];
  return (
    <>
      <button type="button" onClick={() => (playSelect(), setOpen(true))} className="game-action w-full flex-row gap-2 py-2.5 text-sm" data-testid={testId ? `${testId}-open` : undefined}>
        {button}
      </button>
      {open && (
        <GameWindow title={title} icon={icon} accent={accent} size="lg" onClose={() => setOpen(false)} testId={testId}>
          {sections.length > 1 && (
            <nav className="mb-4 flex flex-wrap gap-1.5" data-testid={testId ? `${testId}-tabs` : undefined}>
              {sections.map((s) => (
                <button key={s.id} type="button" onClick={() => (playSelect(), setTab(s.id))} className={`shop-tab px-3 py-1.5 text-xs ${current?.id === s.id ? 'shop-tab-on' : ''}`} aria-pressed={current?.id === s.id}>
                  <span aria-hidden>{s.emoji}</span> {s.label}
                </button>
              ))}
            </nav>
          )}
          {current && <div data-testid={testId ? `${testId}-tab-${current.id}` : undefined}>{current.content}</div>}
        </GameWindow>
      )}
    </>
  );
}

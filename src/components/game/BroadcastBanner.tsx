'use client';

import { Megaphone, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { t } from '@/i18n/t';

const KEY = 'tv-broadcast-hidden';

/** 1.1.3: the team's message for everyone; a player can hide it (the next message shows again). */
export function BroadcastBanner({ text, tone, setAt }: { text: string; tone: 'info' | 'warning'; setAt: string }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try {
      // Reading browser storage after mount keeps the server and client render the same.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHidden(localStorage.getItem(KEY) === setAt);
    } catch {
      /* private mode — always shown */
    }
  }, [setAt]);
  if (hidden) return null;
  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem(KEY, setAt);
    } catch {
      /* private mode */
    }
  };
  const colours = tone === 'warning' ? 'border-amber-sig/30 bg-amber-sig/10' : 'border-cyan-glow/30 bg-cyan-glow/10';
  return (
    <div role="status" className={`flex items-start gap-2 border-b px-4 py-2 text-sm sm:px-6 ${colours}`}>
      <Megaphone className={`mt-0.5 h-4 w-4 shrink-0 ${tone === 'warning' ? 'text-amber-sig' : 'text-cyan-glow'}`} />
      <span className="min-w-0 flex-1"><span className="font-semibold">{t('Съобщение от екипа:')}</span>{' '}{text}</span>
      <button type="button" className="shrink-0 rounded p-0.5 text-mist-400 hover:text-white" onClick={hide} aria-label={t('Скрий')}><X className="h-4 w-4" /></button>
    </div>
  );
}

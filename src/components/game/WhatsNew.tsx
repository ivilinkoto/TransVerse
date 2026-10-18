'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client/api';

/**
 * The "Какво ново" window: shown once after a new version, until the player
 * closes it (remembered on the server, so it does not come back on another device).
 */
export function WhatsNew({ version, children }: { version: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    void api('/api/game/action', { type: 'seenRelease', version }).catch(() => undefined);
  };
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="whats-new-title">
      <button type="button" className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-label="Затвори" onClick={close} />
      <div className="whats-new relative flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-asphalt-700 bg-asphalt-900 shadow-2xl sm:rounded-3xl">
        <button ref={closeButton} type="button" className="absolute right-3 top-3 z-10 rounded-full p-1.5 text-mist-400 hover:bg-asphalt-800 hover:text-white" onClick={close} aria-label="Затвори"><X className="h-5 w-5" /></button>
        <div className="overflow-y-auto p-5 sm:p-7" id="whats-new-title">{children}</div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-asphalt-800 px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-7 sm:pb-3">
          <Link href="/game/updates" onClick={close} className="text-sm text-cyan-glow hover:underline">Всички обновления</Link>
          <button type="button" className="btn-primary" onClick={close}>Към играта</button>
        </div>
      </div>
    </div>
  );
}

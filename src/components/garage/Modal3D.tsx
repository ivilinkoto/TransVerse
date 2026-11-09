'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@/i18n/t';

/**
 * 1.2.3.6: a small „🧊 3D“ button that opens a full-screen window with a 3D view
 * (the truck or the depot). The view itself mounts only while the window is open.
 */
export function Modal3D({ title, children, className = '', testId }: { title: string; children: () => ReactNode; className?: string; testId: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`rounded-lg border border-asphalt-600 bg-asphalt-950/80 px-2 py-1 text-[11px] font-semibold text-mist-100 hover:bg-asphalt-800 ${className}`} aria-label={t('{0} в 3D', title)} data-testid={testId}>
        🧊 3D
      </button>
      {open && createPortal(
        <div role="dialog" aria-modal="true" aria-label={t('{0} в 3D', title)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" onClick={() => setOpen(false)}>
          <div className="flex h-[min(80dvh,640px)] w-[min(960px,100%)] flex-col overflow-hidden rounded-2xl border border-asphalt-600 bg-asphalt-950" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-2 border-b border-asphalt-800 px-4 py-2">
              <span className="truncate font-semibold">{title}</span>
              <button type="button" onClick={() => setOpen(false)} className="text-mist-400 hover:text-white" aria-label={t('Затвори')}>✕</button>
            </div>
            <div className="min-h-0 flex-1">{children()}</div>
            <p className="px-4 py-2 text-[11px] text-mist-400">{t('Върти с пръст или мишка, приближавай с два пръста или колелцето.')}</p>
          </div>
        </div>,
        // On the body: a card with a transform or blur would otherwise hold the window inside it.
        document.body,
      )}
    </>
  );
}

export const Loading3D = () => <div className="flex h-full items-center justify-center text-sm text-mist-400">{t('Зареждане на 3D…')}</div>;

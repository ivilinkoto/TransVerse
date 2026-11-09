'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFeature } from '@/components/game/Features';
import type { TruckLook } from './truck3d';
import { t } from '@/i18n/t';

// three.js loads only when a player opens the 3D view.
const TruckViewer = dynamic(() => import('./TruckViewer').then((m) => m.TruckViewer), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-mist-400">{t('Зареждане на 3D…')}</div>,
});

/** 1.2.3.7: „🧊 3D“ next to a truck drawing — the same truck in 3D, to turn around. */
export function Truck3DButton({ look, title, className = '' }: { look: TruckLook; title: string; className?: string }) {
  const live = useFeature('truck_3d_view');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);
  if (!live) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`rounded-lg border border-asphalt-600 bg-asphalt-950/80 px-2 py-1 text-[11px] font-semibold text-mist-100 hover:bg-asphalt-800 ${className}`} aria-label={t('{0} в 3D', title)} data-testid="truck-3d-open">
        🧊 3D
      </button>
      {open && createPortal(
        <div role="dialog" aria-modal="true" aria-label={t('{0} в 3D', title)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" onClick={() => setOpen(false)}>
          <div className="flex h-[min(80dvh,640px)] w-[min(960px,100%)] flex-col overflow-hidden rounded-2xl border border-asphalt-600 bg-asphalt-950" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-2 border-b border-asphalt-800 px-4 py-2">
              <span className="truncate font-semibold">{title}</span>
              <button type="button" onClick={() => setOpen(false)} className="text-mist-400 hover:text-white" aria-label={t('Затвори')}>✕</button>
            </div>
            <div className="min-h-0 flex-1"><TruckViewer look={look} /></div>
            <p className="px-4 py-2 text-[11px] text-mist-400">{t('Върти с пръст или мишка, приближавай с два пръста или колелцето.')}</p>
          </div>
        </div>,
        // On the body: a card with a transform or blur would otherwise hold the window inside it.
        document.body,
      )}
    </>
  );
}

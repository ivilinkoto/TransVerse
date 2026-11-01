'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Award, CheckCircle2 } from 'lucide-react';
import { motionEnabled, playReveal } from '@/lib/client/motion';
import { burst } from './fx';
import { t } from '@/i18n/t';

type Toast = { id: number; kind: 'medal' | 'delivered'; title: string };

/**
 * 1.1.4.3: effects for live events. A new achievement arrives as a medal that
 * spins in; a delivery on time gets a short „Доставено“ with confetti.
 */
export function FxHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    let seq = 0;
    const onFx = (e: Event) => {
      if (!motionEnabled()) return;
      const d = (e as CustomEvent<{ kind?: string; title?: string; arrival?: boolean }>).detail;
      const kind = d.kind === 'achievement' ? 'medal' : d.arrival && d.kind === 'success' ? 'delivered' : null;
      if (!kind) return;
      const id = ++seq;
      setToasts((list) => [...list.slice(-2), { id, kind, title: d.title ?? '' }]);
      setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), kind === 'medal' ? 5200 : 3600);
      requestAnimationFrame(() => {
        const el = document.getElementById(`fx-toast-${id}`);
        if (!el) return;
        if (kind === 'medal') {
          playReveal(3);
          burst(el, { colors: ['#facc15', '#fde68a', '#f97316', '#ffffff'], count: 46, spread: 200 });
        } else burst(el, { count: 30, spread: 150 });
      });
    };
    window.addEventListener('tv:fx', onFx);
    return () => window.removeEventListener('tv:fx', onFx);
  }, []);
  if (!toasts.length) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-20 z-[85] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} id={`fx-toast-${x.id}`} className="fx-pop flex max-w-md items-center gap-3 rounded-2xl border border-gold-400/50 bg-asphalt-900/95 px-4 py-3 shadow-[0_10px_40px_rgba(0,0,0,.5)]">
          {x.kind === 'medal' ? (
            <span className="fx-medal flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#fde68a] to-gold-500 text-asphalt-950 shadow-[0_0_20px_rgba(250,204,21,.6)]"><Award className="h-7 w-7" /></span>
          ) : (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-profit/20 text-profit"><CheckCircle2 className="h-6 w-6" /></span>
          )}
          <div className="min-w-0">
            <p className="label text-[10px] text-gold-400">{x.kind === 'medal' ? t('Ново постижение') : t('Доставено навреме')}</p>
            <p className="line-clamp-2 text-sm font-semibold">{x.title}</p>
          </div>
        </div>
      ))}
    </div>,
    document.body,
  );
}

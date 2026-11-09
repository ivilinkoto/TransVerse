'use client';

import dynamic from 'next/dynamic';
import { t } from '@/i18n/t';

const TruckViewer = dynamic(() => import('@/components/garage/TruckViewer').then((m) => m.TruckViewer), { ssr: false, loading: () => <div className="h-full w-full animate-pulse rounded-3xl bg-white/[0.03]" /> });

/**
 * 1.3 „Зимен път“: the landing page's hero — one of the game's own 3D trucks (built
 * from code, a fictional brand) turning slowly on a lit stage; drag to look around.
 */
export function HeroTruck({ color = '#1d4ed8' }: { color?: string }) {
  return (
    <div className="hero-stage relative">
      <div className="hero-glow pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative h-72 sm:h-96" aria-label={t('3D камион от играта — завърти го')} role="img">
        <TruckViewer hero look={{ modelId: 'danubia-t440', color, trailerModelId: 'curtain-13', trailerColor: '#e5e7eb', plate: 'TV 2026 BG', company: 'TransVerse' }} />
      </div>
      <div className="hero-road pointer-events-none absolute inset-x-10 bottom-14 h-1.5 sm:bottom-20 rounded-full" aria-hidden />
      <p className="relative mt-1 text-center text-xs text-mist-400">{t('Истински 3D модел от играта · завърти с пръст или мишка')}</p>
    </div>
  );
}

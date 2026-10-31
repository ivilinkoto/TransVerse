'use client';

import { BellRing, ClipboardList, X } from 'lucide-react';
import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { money } from '@/lib/format';
import type { WelcomeBack as Summary } from '@/server/game/welcome-back';
import { t } from '@/i18n/t';

const KEY = 'tv:welcome-back';
const noSubscription = () => () => {};
const readSeen = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

/** 1.1.4.1 „Докато те нямаше“: what the trucks did while the player was away — once per absence. */
export function WelcomeBack({ summary }: { summary: Summary }) {
  // Shown once per absence: the browser remembers which one was seen (the server renders nothing).
  const seen = useSyncExternalStore(noSubscription, () => readSeen() === summary.since, () => true);
  const [closed, setClosed] = useState(false);
  if (seen || closed) return null;
  const close = () => {
    try {
      localStorage.setItem(KEY, summary.since);
    } catch {
      /* no storage: it shows again next time */
    }
    setClosed(true);
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={t('Докато те нямаше')}>
      <button type="button" className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-label={t('Затвори')} onClick={close} />
      <div className="relative w-full max-w-md rounded-t-3xl border border-asphalt-700 bg-asphalt-900 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl sm:pb-5">
        <button type="button" className="absolute right-3 top-3 rounded-full p-1.5 text-mist-400 hover:bg-asphalt-800 hover:text-white" onClick={close} aria-label={t('Затвори')}><X className="h-5 w-5" /></button>
        <p className="label text-cyan-glow">{t('Докато те нямаше')}</p>
        <h2 className="mt-1 font-display text-2xl font-bold">{summary.hours >= 48 ? t('{0} дни по-късно', Math.floor(summary.hours / 24)) : t('{0} часа по-късно', summary.hours)}</h2>
        <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-2xl border border-asphalt-700 bg-asphalt-850 p-3"><dt className="text-[11px] text-mist-400">{t('Курсове')}</dt><dd className="num mt-1 font-display text-xl font-bold">{summary.trips}</dd></div>
          <div className="rounded-2xl border border-asphalt-700 bg-asphalt-850 p-3"><dt className="text-[11px] text-mist-400">{t('Изкарани')}</dt><dd className="num mt-1 font-display text-xl font-bold text-profit">{money(summary.earnedCents)}</dd></div>
          <div className="rounded-2xl border border-asphalt-700 bg-asphalt-850 p-3"><dt className="text-[11px] text-mist-400">{t('Нето')}</dt><dd className={`num mt-1 font-display text-xl font-bold ${summary.netCents < 0 ? 'text-loss' : 'text-gold-400'}`}>{money(summary.netCents)}</dd></div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          {summary.idleTrucks > 0 && <Link href="/game/contracts" onClick={close} className="btn-primary flex-1"><ClipboardList className="h-4 w-4" />{summary.idleTrucks === 1 ? t('Камионът чака курс') : t('{0} камиона чакат курс', summary.idleTrucks)}</Link>}
          {summary.unread > 0 && <Link href="/game/notifications" onClick={close} className="btn-ghost flex-1"><BellRing className="h-4 w-4" />{t('{0} известия', summary.unread)}</Link>}
          {summary.idleTrucks === 0 && summary.unread === 0 && <button type="button" onClick={close} className="btn-primary flex-1">{t('Продължи')}</button>}
        </div>
      </div>
    </div>
  );
}

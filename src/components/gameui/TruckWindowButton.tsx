'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useState } from 'react';
import { GameWindow } from './GameWindow';
import { StatBar, StatTile } from './StatBar';
import { Loading3D } from '@/components/garage/Modal3D';
import type { TruckLook } from '@/components/garage/truck3d';
import { useFeature } from '@/components/game/Features';
import { playSelect } from '@/lib/client/motion';
import { int } from '@/lib/format';
import { t } from '@/i18n/t';

const TruckViewer = dynamic(() => import('@/components/garage/TruckViewer').then((m) => m.TruckViewer), { ssr: false, loading: Loading3D });

export interface TruckWindowData {
  title: string;
  plate: string;
  status: string;
  where: string;
  look: TruckLook;
  condition: number;
  /** Km to the next service (negative: overdue), or null for rented trucks. */
  serviceInKm: number | null;
  serviceEveryKm: number;
  odometerKm: string;
  payload: string;
  driver: string | null;
  driverSkill: number | null;
  trailer: string | null;
  trips: number;
  longestKm: string;
  totalKm: string;
  upgrades: string[];
  main: { href: string; label: string };
  actions: { href: string; label: string; emoji: string }[];
}

/**
 * 1.2.3.6 „Нов облик“: „Всичко за този камион“ as a game window — the truck in 3D,
 * its condition and service as bars, the facts as tiles, and the actions as game buttons.
 */
export function TruckWindowButton({ data }: { data: TruckWindowData }) {
  const [open, setOpen] = useState(false);
  const show3d = useFeature('truck_3d_view');
  return (
    <>
      <button type="button" onClick={() => (playSelect(), setOpen(true))} className="game-action w-full flex-row gap-2 py-2.5 text-sm" data-testid="truck-window-open">
        <span aria-hidden>🚛</span>{t('Всичко за този камион')}
      </button>
      {open && (
        <GameWindow title={`${data.title} · ${data.plate}`} icon="🚛" accent="#22d3ee" size="lg" onClose={() => setOpen(false)} testId="truck-window">
          <div className="grid gap-4 md:grid-cols-[1.25fr_1fr]">
            <div className="space-y-3">
              <div className="h-56 overflow-hidden rounded-2xl border border-white/10 bg-asphalt-950 sm:h-64">
                {show3d ? <TruckViewer look={data.look} /> : <div className="flex h-full items-center justify-center text-5xl">🚛</div>}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="rounded-full border border-cyan-glow/40 bg-cyan-glow/10 px-2.5 py-1 font-semibold text-cyan-glow">{data.status}</span>
                <span className="text-mist-300">📍 {data.where}</span>
              </div>
              {data.upgrades.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {data.upgrades.map((u) => <span key={u} className="rounded-lg border border-violet-400/40 bg-violet-500/10 px-2 py-0.5 text-[11px] font-semibold text-violet-200">⚙️ {u}</span>)}
                </div>
              )}
            </div>
            <div className="space-y-3">
              <StatBar label={t('Състояние')} icon="🛠️" value={data.condition} text={`${Math.round(data.condition)}%`} />
              {data.serviceInKm !== null && (
                <StatBar
                  label={t('До профилактика')}
                  icon="🧰"
                  value={Math.max(0, data.serviceInKm)}
                  max={data.serviceEveryKm}
                  text={data.serviceInKm < 0 ? t('просрочена') : t('{0} км', int(Math.round(data.serviceInKm)))}
                />
              )}
              {data.driverSkill !== null && <StatBar label={t('Умение на шофьора')} icon="🧑‍✈️" value={data.driverSkill} max={5} text={`${data.driverSkill}/5`} colour="#a78bfa" />}
              <div className="grid grid-cols-2 gap-2">
                <StatTile icon="🧭" label={t('Пробег')} value={data.odometerKm} />
                <StatTile icon="⚖️" label={t('Товароносимост')} value={data.payload} />
                <StatTile icon="🧑‍✈️" label={t('Шофьор')} value={data.driver ?? t('няма')} />
                <StatTile icon="🔗" label={t('Ремарке')} value={data.trailer ?? t('без')} />
                <StatTile icon="📦" label={t('Курсове')} value={String(data.trips)} />
                <StatTile icon="🏁" label={t('Най-дълъг курс')} value={data.longestKm} />
              </div>
              <p className="text-[11px] text-mist-400">{t('Изминати с товар и празен: {0}', data.totalKm)}</p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <Link href={data.main.href} className="game-action game-action-main w-full flex-row py-3 text-sm" onClick={() => setOpen(false)}>{data.main.label}</Link>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {data.actions.map((a) => (
                <Link key={a.label} href={a.href} className="game-action" onClick={() => setOpen(false)}>
                  <span className="text-2xl" aria-hidden>{a.emoji}</span>
                  {a.label}
                </Link>
              ))}
            </div>
          </div>
        </GameWindow>
      )}
    </>
  );
}

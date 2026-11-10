'use client';

import type { ReactNode } from 'react';
import { GameWindow } from './GameWindow';
import { StatTile } from './StatBar';
import { dec, duration, km, money } from '@/lib/format';
import { t, tx } from '@/i18n/t';

export interface ContractWindowHead {
  goods: string;
  cargoLabel: string;
  tons: number;
  rewardCents: number;
  distanceKm: number;
  windowMinutes: number;
  urgent: boolean;
  origin: { name: string; country: string };
  destination: { name: string; country: string };
  stops: { name: string }[];
}

/** The route as a road: the cities as pins, a dashed line and a truck rolling along it. */
function RouteStrip({ head }: { head: ContractWindowHead }) {
  const points = [head.origin.name, ...head.stops.map((s) => s.name), head.destination.name];
  return (
    <div className="contract-road relative rounded-2xl px-4 pb-4 pt-10">
      <div className="contract-road-line absolute left-8 right-8 top-[3.1rem]" aria-hidden />
      <span className="contract-road-truck absolute top-[1.9rem] text-2xl" aria-hidden>🚚</span>
      <ol className="relative flex justify-between gap-2">
        {points.map((p, i) => (
          <li key={`${p}-${i}`} className="flex min-w-0 flex-1 flex-col items-center text-center first:items-start first:text-left last:items-end last:text-right">
            <span className={`contract-pin ${i === 0 ? 'contract-pin-from' : i === points.length - 1 ? 'contract-pin-to' : ''}`} aria-hidden />
            <span className="mt-2 max-w-full truncate text-sm font-bold text-white">{tx(p)}</span>
            {i === 0 && <span className="text-[11px] text-mist-400">{tx(head.origin.country)}</span>}
            {i === points.length - 1 && <span className="text-[11px] text-mist-400">{tx(head.destination.country)}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** After „Приеми и изпрати“: the truck drives off and the window says where it goes. */
function Departed({ text, onDone }: { text: string; onDone: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center" data-testid="contract-departed">
      <div className="relative h-24 w-full overflow-hidden">
        <div className="contract-road-line absolute left-0 right-0 top-16" aria-hidden />
        <span className="contract-drive absolute top-6 text-5xl" aria-hidden>🚚</span>
      </div>
      <p className="fx-stamp font-display text-2xl font-bold text-profit">{t('На път!')}</p>
      <p role="status" className="max-w-md text-sm text-mist-200">{text}</p>
      <button type="button" className="game-action game-action-main flex-row px-8 py-3 text-sm" onClick={onDone}>{t('Супер')}</button>
    </div>
  );
}

/**
 * 1.2.3.6 „Нов облик“: a load from the board as a game window — the route as a road,
 * the pay and the facts as tiles, and below them the details and the take panel.
 */
export function ContractWindow({ head, departed, onClose, onDone, children }: { head: ContractWindowHead; departed: string | null; onClose: () => void; onDone: () => void; children: ReactNode }) {
  return (
    <GameWindow
      title={`${tx(head.goods)} · ${tx(head.origin.name)} → ${tx(head.destination.name)}`}
      icon="📦"
      accent={head.urgent ? '#f43f5e' : '#22d3ee'}
      size="lg"
      onClose={departed ? onDone : onClose}
      testId="contract-window"
    >
      {departed ? (
        <Departed text={departed} onDone={onDone} />
      ) : (
        <div className="space-y-4">
          <RouteStrip head={head} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="stat-tile col-span-2 flex items-center justify-between gap-2 rounded-2xl px-4 py-3 sm:col-span-1 sm:flex-col sm:items-start">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-mist-400">💰 {t('Заплащане')}</span>
              <span className="num font-display text-2xl font-bold text-profit">{money(head.rewardCents)}</span>
            </div>
            <StatTile icon="🛣️" label={t('Разстояние')} value={km(head.distanceKm)} />
            <StatTile icon="⏱️" label={t('Срок')} value={duration(head.windowMinutes)} />
            <StatTile icon="📦" label={tx(head.cargoLabel)} value={t('{0} т', dec(head.tons))} />
          </div>
          <div className="contract-body">{children}</div>
        </div>
      )}
    </GameWindow>
  );
}

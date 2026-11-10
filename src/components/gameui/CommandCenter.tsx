import Link from 'next/link';
import type { ReactNode } from 'react';
import { int, money } from '@/lib/format';
import { t, tx } from '@/i18n/t';

export interface CommandTile {
  href: string;
  emoji: string;
  label: string;
  /** A small counter in the corner (e.g. free trucks), or nothing. */
  badge?: string | null;
  colour: string;
}

export interface CommandNow {
  emoji: string;
  text: string;
  action: string;
  href: string;
  tone: string;
}

/**
 * 1.3 „Нов облик“: the dashboard's top as a game command centre — the player's card
 * (level, money, coins, trucks on the road), what waits now as cards, and big tiles
 * to every part of the game.
 */
export function CommandCenter({
  greeting,
  username,
  level,
  levelShare,
  xp,
  xpNext,
  reputation,
  balanceCents,
  netCents,
  coins,
  onRoad,
  trucks,
  truck,
  now,
  tiles,
  primary,
}: {
  greeting: string;
  username: string;
  level: number;
  levelShare: number;
  xp: number;
  xpNext: number;
  reputation: number;
  balanceCents: number;
  netCents: number;
  coins: number;
  onRoad: number;
  trucks: number;
  truck: ReactNode;
  now: CommandNow[];
  tiles: CommandTile[];
  primary: { href: string; label: string };
}) {
  const ring = Math.max(0, Math.min(1, levelShare));
  return (
    <section className="space-y-4" data-testid="command-center">
      <div className="dash-hero relative overflow-hidden rounded-3xl p-5 sm:p-6">
        <div className="dash-road pointer-events-none absolute inset-x-0 bottom-0 h-16" aria-hidden />
        <div className="relative flex flex-col gap-5 md:flex-row md:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <div className="dash-level relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full" style={{ '--ring': `${ring * 360}deg` } as React.CSSProperties} title={t('{0} / {1} опит', xp, xpNext)}>
              <span className="flex h-[66px] w-[66px] flex-col items-center justify-center rounded-full bg-asphalt-950">
                <span className="text-[10px] font-bold uppercase tracking-wider text-mist-400">{t('ниво')}</span>
                <span className="num font-display text-2xl font-bold leading-none text-white">{level}</span>
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-glow">{greeting}</p>
              <h1 className="truncate font-display text-2xl font-bold text-white sm:text-3xl">{tx(username)}</h1>
              <p className="text-xs text-mist-400">{t('{0} / {1} опит · реп. {2}', xp, xpNext, reputation.toFixed(1))}</p>
            </div>
          </div>
          <div className="relative hidden shrink-0 md:block">{truck}</div>
        </div>
        <dl className="relative mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="dash-stat rounded-2xl px-3 py-2">
            <dt className="text-[11px] font-semibold text-mist-400">💰 {t('Наличност')}</dt>
            <dd className={`num font-display text-lg font-bold ${balanceCents < 0 ? 'text-loss' : 'text-gold-400'}`}>{money(balanceCents)}</dd>
          </div>
          <div className="dash-stat rounded-2xl px-3 py-2">
            <dt className="text-[11px] font-semibold text-mist-400">📈 {t('Нето · 7 дни')}</dt>
            <dd className={`num font-display text-lg font-bold ${netCents < 0 ? 'text-loss' : 'text-profit'}`}>{money(netCents)}</dd>
          </div>
          <div className="dash-stat rounded-2xl px-3 py-2">
            <dt className="text-[11px] font-semibold text-mist-400">🪙 {t('ТрансКоин')}</dt>
            <dd className="num font-display text-lg font-bold text-cyan-glow">{int(coins)}</dd>
          </div>
          <div className="dash-stat rounded-2xl px-3 py-2">
            <dt className="text-[11px] font-semibold text-mist-400">🚚 {t('На път')}</dt>
            <dd className="num font-display text-lg font-bold text-white">{onRoad} / {trucks}</dd>
          </div>
        </dl>
        <div className="relative mt-4 flex flex-wrap gap-2">
          <Link href={primary.href} className="game-action game-action-main flex-row px-5 py-2.5 text-sm">{primary.label}</Link>
        </div>
      </div>

      {now.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-mist-400">{now.length === 1 ? t('Едно нещо те чака') : t('{0} неща те чакат', now.length)}</h2>
          <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 xl:grid-cols-3" data-testid="now-cards">
            {now.map((it, i) => (
              <li key={i} className="w-[78%] shrink-0 snap-start sm:w-auto">
                <Link href={it.href} className={`dash-now flex h-full items-center gap-3 rounded-2xl p-3 dash-now-${it.tone}`}>
                  <span className="dash-now-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl" aria-hidden>{it.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 block text-sm text-mist-100">{tx(it.text)}</span>
                    <span className="mt-0.5 block text-xs font-bold text-cyan-glow">{tx(it.action)} →</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <nav aria-label={t('Бърз достъп')}>
        <ul className="grid grid-cols-4 gap-2 sm:gap-3 lg:grid-cols-8" data-testid="dash-tiles">
          {tiles.map((tile) => (
            <li key={tile.href}>
              <Link href={tile.href} className="dash-tile relative flex aspect-square flex-col items-center justify-center gap-1 rounded-2xl p-2 text-center" style={{ '--tile': tile.colour } as React.CSSProperties}>
                <span className="dash-tile-emoji text-3xl sm:text-4xl" aria-hidden>{tile.emoji}</span>
                <span className="text-[11px] font-bold leading-tight text-white sm:text-xs">{tx(tile.label)}</span>
                {tile.badge && <span className="dash-tile-badge num absolute right-1.5 top-1.5 rounded-full px-1.5 text-[10px] font-bold">{tile.badge}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}

import { Coins, Gift, Plus, Wallet } from 'lucide-react';
import Link from 'next/link';
import { LogoMark } from '@/components/brand/Logo';
import { levelProgress } from '@/lib/game/progression';
import { money } from '@/lib/format';
import { AccountMenu, NotificationBell } from './HeaderMenu';
import { PlayerSearch } from './PlayerSearch';
import { CommandPalette } from './CommandPalette';

const chip = 'flex h-9 items-center gap-1.5 rounded-full border px-2.5 sm:px-3 transition';

/** Slim top bar: who you are on the left; money, ТрансКоин, gift, bell and the avatar menu on the right. */
export function TopBar({ title, kind, company, user, vip, hqName, unread, staff, attention = 0, dailyReady = false }: { title: string; kind: string; company: { balanceCents: number; reputation: number }; user: { id: string; username: string; xp: number; role: string; coins: number; avatarVersion: number }; vip: boolean; hqName: string; unread: number; staff: boolean; attention?: number; dailyReady?: boolean }) {
  const lp = levelProgress(user.xp);
  return (
    <header className="sticky top-0 z-40 border-b border-asphalt-800/80 bg-asphalt-950/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="flex h-14 items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:h-16">
        <Link href="/game" className="shrink-0 lg:hidden" aria-label="TransVerse — табло"><LogoMark className="h-8 w-8" /></Link>
        <div className="hidden min-w-0 flex-1 sm:block">
          <div className="truncate font-display text-base font-bold leading-tight lg:text-lg">{title}</div>
          <div className="truncate text-xs text-mist-400">{kind === 'company' ? 'Собствен автопарк' : 'Самостоятелен шофьор'} · база {hqName}</div>
        </div>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <Link href="/game/finance" className={`${chip} border-asphalt-700 bg-asphalt-900/60 hover:border-gold-400/50`} title="Наличност — финанси">
            <Wallet className="h-4 w-4 text-gold-400 max-sm:hidden" />
            <span className={`num whitespace-nowrap font-display text-sm font-bold sm:text-base ${company.balanceCents < 0 ? 'text-loss' : 'text-gold-400'}`}>{money(company.balanceCents)}</span>
          </Link>
          <Link href="/game/shop" className={`${chip} border-cyan-glow/30 bg-cyan-glow/10 min-[420px]:pr-1.5 hover:bg-cyan-glow/20`} title="ТрансКоин — магазин и VIP">
            <Coins className="h-4 w-4 text-cyan-glow" />
            <span className="num whitespace-nowrap font-display text-sm font-bold text-cyan-glow">{user.coins.toLocaleString('bg-BG')}<span className="max-sm:hidden"> TC</span></span>
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-glow/20 text-cyan-glow max-[419px]:hidden"><Plus className="h-3.5 w-3.5" /></span>
          </Link>
          {dailyReady && (
            <Link href="/game#daily" className="relative flex h-9 w-9 items-center justify-center rounded-full border border-gold-400/50 bg-gold-400/10 text-gold-400 transition hover:bg-gold-400/20" title="Дневната награда те чака" aria-label="Дневната награда те чака">
              <Gift className="h-4 w-4" />
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-gold-400" />
            </Link>
          )}
          <CommandPalette />
          <PlayerSearch />
          <NotificationBell unread={unread} />
          <AccountMenu staff={staff} attention={attention} user={{ id: user.id, username: user.username, role: user.role, vip, avatarVersion: user.avatarVersion }} level={{ level: lp.level, share: lp.share, current: lp.current, next: lp.next }} reputation={company.reputation} />
        </div>
      </div>
    </header>
  );
}

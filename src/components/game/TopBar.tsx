import { CalendarClock, Coins, Gem, Gift, Medal, Star, Wallet } from 'lucide-react';
import Link from 'next/link';
import { levelProgress } from '@/lib/game/progression';
import { money } from '@/lib/format';
import { AccountMenu, NotificationBell } from './HeaderMenu';
import { PlayerName } from './PlayerName';

const pill = 'flex h-9 items-center gap-1.5 rounded-full border border-asphalt-700 px-3 text-sm text-mist-300 transition hover:bg-asphalt-800 hover:text-white';

export function TopBar({ title, kind, company, user, vip, hqName, unread, staff, dailyReady = false }: { title: string; kind: string; company: { balanceCents: number; reputation: number }; user: { username: string; xp: number; role: string; coins: number }; vip: boolean; hqName: string; unread: number; staff: boolean; dailyReady?: boolean }) {
  const lp = levelProgress(user.xp);
  return (
    <header className="relative z-40 flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-asphalt-800 bg-asphalt-950/80 px-4 py-3 backdrop-blur sm:px-6">
      <div className="min-w-0 basis-full xl:basis-0 xl:flex-1">
        <div className="truncate font-display text-lg font-bold">{title}</div>
        <div className="flex flex-wrap items-center gap-1 text-xs text-mist-400">{kind === 'company' ? `Собствен автопарк · база ${hqName}` : `Самостоятелен шофьор · база ${hqName}`} · <PlayerName name={user.username} role={user.role} vip={vip} /></div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 xl:flex-nowrap">
      <nav className="flex items-center gap-2" aria-label="Състезание">
        <Link href="/game/leaderboards" className={pill} title="Класации" aria-label="Класации">
          <Medal className="h-4 w-4 text-gold-400" />
          <span className="hidden 2xl:inline">Класации</span>
        </Link>
        <Link href="/game/seasons" className={pill} title="Сезони" aria-label="Сезони">
          <CalendarClock className="h-4 w-4 text-cyan-glow" />
          <span className="hidden 2xl:inline">Сезони</span>
        </Link>
      </nav>
      <div className="flex items-center gap-2" title="Наличност">
        <Wallet className="h-4 w-4 text-gold-400" />
        <span className={`num whitespace-nowrap font-display text-lg font-bold ${company.balanceCents < 0 ? 'text-loss' : 'text-gold-400'}`}>{money(company.balanceCents)}</span>
      </div>
      <Link href="/game/shop" className="flex h-9 items-center gap-1.5 rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-3 hover:bg-cyan-glow/20" title="ТрансКоин — магазин">
        <Coins className="h-4 w-4 text-cyan-glow" />
        <span className="num whitespace-nowrap font-display text-sm font-bold text-cyan-glow">{user.coins.toLocaleString('bg-BG')} TC</span>
      </Link>
      <Link href="/game/shop" className="flex h-9 items-center gap-1.5 rounded-full border border-gold-400/40 bg-gold-400/10 whitespace-nowrap px-3 text-sm font-semibold text-gold-400 transition hover:bg-gold-400/20" title="Магазин · VIP" aria-label="Магазин · VIP">
        <Gem className="h-4 w-4" />
        <span className="hidden sm:inline">Магазин · VIP</span>
      </Link>
      <div className="w-28 lg:w-32" title={`Опит ${lp.current} / ${lp.next}`}>
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold">Ниво {lp.level}</span>
          <span className="num text-mist-400">{Math.round(lp.share * 100)}%</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-asphalt-700">
          <div className="h-full rounded-full bg-gradient-to-r from-cyan-glow to-volt-500" style={{ width: `${Math.max(2, lp.share * 100)}%` }} />
        </div>
      </div>
      {dailyReady && (
        <Link href="/game#daily" className="relative flex h-9 w-9 items-center justify-center rounded-full border border-gold-400/50 bg-gold-400/10 text-gold-400 transition hover:bg-gold-400/20" title="Дневната награда те чака" aria-label="Дневната награда те чака">
          <Gift className="h-4 w-4" />
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-gold-400" />
        </Link>
      )}
      <NotificationBell unread={unread} />
      <div className="flex items-center gap-1.5 text-sm" title="Репутация">
        <Star className="h-4 w-4 text-prestige" />
        <span className="num font-semibold">{company.reputation.toFixed(1)}</span>
      </div>
      <AccountMenu staff={staff} />
      </div>
    </header>
  );
}

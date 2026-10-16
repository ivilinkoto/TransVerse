import { Star, Wallet } from 'lucide-react';
import { levelProgress } from '@/lib/game/progression';
import { money } from '@/lib/format';

export function TopBar({ company, user, hqName }: { company: { name: string; balanceCents: number; reputation: number }; user: { username: string; xp: number }; hqName: string }) {
  const lp = levelProgress(user.xp);
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-asphalt-800 bg-asphalt-950/80 px-4 py-3 backdrop-blur sm:px-6">
      <div className="min-w-0 flex-1">
        <div className="truncate font-display text-lg font-bold">{company.name}</div>
        <div className="text-xs text-mist-400">Седалище: {hqName} · {user.username}</div>
      </div>
      <div className="flex items-center gap-2" title="Наличност">
        <Wallet className="h-4 w-4 text-gold-400" />
        <span className={`num font-display text-lg font-bold ${company.balanceCents < 0 ? 'text-loss' : 'text-gold-400'}`}>{money(company.balanceCents)}</span>
      </div>
      <div className="w-40" title={`Опит ${lp.current} / ${lp.next}`}>
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold">Ниво {lp.level}</span>
          <span className="num text-mist-400">{Math.round(lp.share * 100)}%</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-asphalt-700">
          <div className="h-full rounded-full bg-gradient-to-r from-cyan-glow to-volt-500" style={{ width: `${Math.max(2, lp.share * 100)}%` }} />
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-sm" title="Репутация">
        <Star className="h-4 w-4 text-prestige" />
        <span className="num font-semibold">{company.reputation.toFixed(1)}</span>
      </div>
    </header>
  );
}

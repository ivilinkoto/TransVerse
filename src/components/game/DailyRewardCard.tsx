import { CheckCircle2, Flame, Gift } from 'lucide-react';
import { ActionButton } from '@/components/ui/ActionButton';
import { money } from '@/lib/format';
import { DAILY_REWARDS, dailyState } from '@/lib/game/daily';

/** The 7-day reward cycle: a compact strip while today's reward waits; hidden once it is taken. */
export function DailyRewardCard({ streak, lastKey, now }: { streak: number; lastKey: string | null; now: Date }) {
  const s = dailyState(streak, lastKey, now);
  if (s.claimedToday) return null;
  return (
    <section id="daily" aria-label="Дневна награда" className="panel scroll-mt-24 border-gold-400/40 bg-gradient-to-r from-gold-400/12 via-asphalt-900/80 to-asphalt-900/80 p-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gold-400/15 text-gold-400"><Gift className="h-6 w-6" /></span>
          <div className="min-w-0">
            <h2 className="font-display font-bold">Дневна награда · ден {s.cycleDay}</h2>
            <p className="text-sm text-mist-300">
              <span className="num font-semibold text-gold-400">{money(s.reward.cents)}</span>, +{s.reward.xp} опит{s.reward.coins ? <>, <span className="text-cyan-glow">+{s.reward.coins} TC</span></> : ''}
              {s.streak > 0 && <span className="ml-2 inline-flex items-center gap-0.5 text-amber-sig"><Flame className="h-3.5 w-3.5" />{s.streak} {s.streak === 1 ? 'ден' : 'дни'} подред</span>}
            </p>
          </div>
        </div>
        <ol className="grid grid-cols-7 gap-1.5 md:w-72" aria-label="Цикъл от 7 дни">
          {DAILY_REWARDS.map((r, i) => {
            const day = i + 1;
            const done = day < s.cycleDay;
            const today = day === s.cycleDay;
            return (
              <li key={day} title={`Ден ${day}: ${money(r.cents)}${r.coins ? ` + ${r.coins} TC` : ''}`} className={`flex flex-col items-center rounded-lg border py-1.5 text-[10px] font-semibold ${today ? 'border-gold-400 bg-gold-400/15 text-gold-400' : done ? 'border-profit/40 bg-profit/5 text-profit' : 'border-asphalt-700 text-mist-400'}`}>
                {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Gift className={`h-3.5 w-3.5 ${day === 7 && !today ? 'text-cyan-glow' : ''}`} />}
                <span className="mt-0.5">{day}</span>
              </li>
            );
          })}
        </ol>
        <ActionButton action={{ type: 'claimDaily' }} className="btn-gold w-full md:w-auto"><Gift className="h-4 w-4" />Вземи</ActionButton>
      </div>
    </section>
  );
}

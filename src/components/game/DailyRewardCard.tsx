import { CheckCircle2, Flame, Gift } from 'lucide-react';
import { Card } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { money } from '@/lib/format';
import { DAILY_REWARDS, dailyState } from '@/lib/game/daily';

/** The 7-day reward cycle with today's tile and the claim button. */
export function DailyRewardCard({ streak, lastKey, now }: { streak: number; lastKey: string | null; now: Date }) {
  const s = dailyState(streak, lastKey, now);
  return (
    <Card
      id="daily"
      title={<span className="inline-flex items-center gap-2"><Gift className="h-4 w-4 text-gold-400" />Дневна награда</span>}
      actions={s.streak > 0 ? <span className="inline-flex items-center gap-1 text-sm font-semibold text-amber-sig"><Flame className="h-4 w-4" />Серия: {s.streak} {s.streak === 1 ? 'ден' : 'дни'}</span> : <span className="text-xs text-mist-400">Влизай всеки ден — 7-ият ден е най-ценен</span>}
    >
      <ol className="grid grid-cols-4 gap-2 sm:grid-cols-7">
        {DAILY_REWARDS.map((r, i) => {
          const day = i + 1;
          const isNext = day === s.cycleDay;
          const done = s.claimedToday ? day <= s.cycleDay : day < s.cycleDay;
          return (
            <li key={day} className={`rounded-xl border p-2 text-center text-xs ${isNext && !s.claimedToday ? 'border-gold-400 bg-gold-400/10 shadow-[0_0_0_1px_rgba(246,195,67,0.4)]' : done ? 'border-profit/40 bg-profit/5' : 'border-asphalt-700'} ${day === 7 ? 'col-span-2 sm:col-span-1' : ''}`}>
              <div className="font-semibold text-mist-300">Ден {day}</div>
              {done ? <CheckCircle2 className="mx-auto my-1 h-4 w-4 text-profit" /> : <Gift className={`mx-auto my-1 h-4 w-4 ${day === 7 ? 'text-gold-400' : 'text-mist-400'}`} />}
              <div className="num font-semibold">{money(r.cents)}</div>
              {r.coins > 0 && <div className="num text-cyan-glow">+{r.coins} TC</div>}
            </li>
          );
        })}
      </ol>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
        {s.claimedToday ? (
          <span className="text-profit">Днешната награда е взета. Утре те чака ден {(s.cycleDay % 7) + 1}.</span>
        ) : (
          <>
            <span className="text-mist-300">Днес: <span className="num font-semibold text-gold-400">{money(s.reward.cents)}</span>, +{s.reward.xp} опит{s.reward.coins ? `, +${s.reward.coins} TC` : ''}</span>
            <ActionButton action={{ type: 'claimDaily' }} className="btn-gold"><Gift className="h-4 w-4" />Вземи наградата</ActionButton>
          </>
        )}
      </div>
    </Card>
  );
}

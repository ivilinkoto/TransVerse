import { Flag } from 'lucide-react';
import { Badge, Card, Meter } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { duration, money } from '@/lib/format';

interface Goal {
  weekKey: string;
  title: string;
  level: string;
  target: number;
  progress: number;
  rewardCents: number;
  rewardCoins: number;
  claimedAt: Date | null;
}
interface Choice {
  difficulty: string;
  title: string;
  level: string;
  rewardCents: number;
  rewardCoins: number;
}

const TONE: Record<string, 'green' | 'cyan' | 'red'> = { easy: 'green', normal: 'cyan', hard: 'red' };

/** The player's own goal for the week: three choices sized to their pace, or the chosen one with progress. */
export function WeeklyGoalCard({ state, now }: { state: { endsAt: Date; goal: Goal | null; previous: Goal | null; choices: Choice[] }; now: Date }) {
  const left = duration(Math.max(0, (state.endsAt.getTime() - now.getTime()) / 60_000));
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Flag className="h-4 w-4 text-gold-400" />Седмична цел</span>} actions={<span className="text-xs text-mist-400">остават {left}</span>}>
      {state.previous && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-profit/40 bg-profit/5 p-3 text-sm">
          <span>Миналата седмица: <b>{state.previous.title}</b> — изпълнена!</span>
          <ActionButton action={{ type: 'claimWeeklyGoal', week: state.previous.weekKey }} className="btn-gold px-3 py-1.5 text-xs">Вземи {money(state.previous.rewardCents)} + {state.previous.rewardCoins} TC</ActionButton>
        </div>
      )}
      {state.goal ? (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{state.goal.title}</span>
            <Badge tone="gold">{state.goal.level} · {money(state.goal.rewardCents)} + {state.goal.rewardCoins} TC</Badge>
          </div>
          <Meter value={(state.goal.progress / state.goal.target) * 100} tone="gold" className="mt-3" />
          <div className="mt-2 flex items-center justify-between text-xs text-mist-400">
            <span className="num">{Math.floor(state.goal.progress).toLocaleString('bg-BG')} / {state.goal.target.toLocaleString('bg-BG')}</span>
            {state.goal.claimedAt ? (
              <Badge tone="green">взета</Badge>
            ) : (
              <ActionButton action={{ type: 'claimWeeklyGoal', week: state.goal.weekKey }} className="btn-gold px-3 py-1.5 text-xs" disabled={state.goal.progress < state.goal.target}>Вземи наградата</ActionButton>
            )}
          </div>
        </div>
      ) : (
        <div>
          <p className="mb-3 text-sm text-mist-300">Избери си една цел за седмицата — размерът е според твоето темпо през последния месец. Броят се курсовете от момента на избора.</p>
          <ul className="grid gap-3 sm:grid-cols-3">
            {state.choices.map((c) => (
              <li key={c.difficulty} className="flex flex-col rounded-xl border border-asphalt-700 p-3">
                <Badge tone={TONE[c.difficulty] ?? 'neutral'}>{c.level}</Badge>
                <div className="mt-2 font-semibold">{c.title}</div>
                <div className="mb-3 mt-1 text-xs text-gold-400">{money(c.rewardCents)} + {c.rewardCoins} TC</div>
                <ActionButton action={{ type: 'chooseWeeklyGoal', difficulty: c.difficulty }} className="btn-primary mt-auto justify-center px-3 py-1.5 text-sm">Избери</ActionButton>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

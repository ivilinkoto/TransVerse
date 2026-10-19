import { CalendarClock, CheckCircle2, Coins, Gift, Shuffle, Star, Target } from 'lucide-react';
import { isVip } from '@/lib/game/vip';
import { Badge, Card, Meter, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { dateTime, duration, int, money } from '@/lib/format';
import { MISSION_PERIODS, MISSION_REROLL_COINS, PERIOD_LABELS, missionById, type MissionPeriod } from '@/lib/game/missions';
import { gameContext } from '@/server/game/context';
import { missionBoard } from '@/server/game/missions';
import { weeklyGoalState } from '@/server/game/weekly-goal';
import { WeeklyGoalCard } from '@/components/game/WeeklyGoalCard';

export const metadata = { title: 'Мисии' };

type Row = Awaited<ReturnType<typeof missionBoard>>['current'][number];

const PERIOD_HINT: Record<MissionPeriod, string> = {
  daily: 'Нови всеки ден в 00:00 (българско време).',
  weekly: 'Нови всеки понеделник.',
  monthly: 'Нови на 1-во число.',
  season: 'За целия игрови сезон.',
};

function format(row: Row, value: number) {
  const def = missionById(row.missionId);
  return def?.metric === 'earned_cents' ? money(value) : int(Math.floor(value));
}

function MissionCard({ row, reroll }: { row: Row; reroll?: { label: string; disabled: boolean } }) {
  const def = missionById(row.missionId);
  const share = row.target ? (row.progress / row.target) * 100 : 0;
  return (
    <li className={`rounded-xl border p-4 ${row.claimedAt ? 'border-asphalt-700 opacity-70' : row.completedAt ? 'border-profit/50 bg-profit/5' : 'border-asphalt-700'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold">
            {row.completedAt ? <CheckCircle2 className="h-4 w-4 shrink-0 text-profit" /> : <Target className="h-4 w-4 shrink-0 text-cyan-glow" />}
            <span>{def ? def.title(row.target) : row.missionId}</span>
          </div>
          {def?.metric === 'countries' && row.data.countries?.length ? <div className="mt-1 text-xs text-mist-400">Държави: {row.data.countries.join(', ')}</div> : null}
        </div>
        <div className="shrink-0 text-right text-xs">
          <div className="num font-semibold text-gold-400">{money(row.rewardCents)}</div>
          <div className="num text-prestige">+{int(row.rewardXp)} опит</div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-mist-400">
        <span className="num">{format(row, row.progress)} / {format(row, row.target)}</span>
        <span className="num">{Math.floor(Math.min(100, share))}%</span>
      </div>
      <Meter value={share} tone={row.completedAt ? 'auto' : 'cyan'} className="mt-1" />
      {row.completedAt && !row.claimedAt && (
        <div className="mt-3">
          <ActionButton action={{ type: 'claimMission', periodKey: row.periodKey, missionId: row.missionId }} className="btn-gold px-4 py-2 text-sm">
            <Gift className="h-4 w-4" />Вземи наградата
          </ActionButton>
        </div>
      )}
      {row.claimedAt && <p className="mt-3 text-xs text-profit">Наградата е взета · {dateTime(row.claimedAt)}</p>}
      {reroll && !row.completedAt && (
        <div className="mt-3">
          <ActionButton action={{ type: 'rerollMission', periodKey: row.periodKey, missionId: row.missionId }} className="btn-ghost px-3 py-1.5 text-xs" disabled={reroll.disabled} confirm="Да сменим ли тази мисия с друга?">
            <Shuffle className="h-3.5 w-3.5" />{reroll.label}
          </ActionButton>
        </div>
      )}
    </li>
  );
}

export default async function MissionsPage() {
  const { db, user, now, features } = await gameContext();
  const { windows, current, unclaimed } = await missionBoard(db, user.id, now);
  const goal = features.weekly_goal ? await weeklyGoalState(db, user.id, now) : null;
  const done = current.filter((r) => r.completedAt).length;
  const waiting = [...current, ...unclaimed].filter((r) => r.completedAt && !r.claimedAt);
  const waitingCents = waiting.reduce((s, r) => s + r.rewardCents, 0);
  // Mission swap: one free per day for VIP, otherwise ТрансКоин.
  const vip = isVip(user.vipUntil, now);
  const dailyKey = windows.find((w) => w.period === 'daily')!.key;
  const freeSwap = vip && user.vipRerollKey !== dailyKey;
  const reroll = { label: freeSwap ? 'Смени · безплатно (VIP)' : `Смени · ${MISSION_REROLL_COINS} TC`, disabled: !freeSwap && user.coins < MISSION_REROLL_COINS };
  return (
    <div className="space-y-6">
      <PageHeader title="Мисии" subtitle="Цели за деня, седмицата, месеца и сезона."
        help="Прогресът се отчита автоматично при всяка доставка; наградата се взима с бутон (VIP — автоматично). Мисиите се подбират според нивото и лицензите ти; VIP получава +1 дневна и +1 седмична мисия." />
      {goal && <WeeklyGoalCard state={goal} now={now} />}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="panel flex items-center gap-3 p-3 sm:p-4"><Target className="hidden h-5 w-5 shrink-0 sm:block text-cyan-glow" /><div><div className="label">Изпълнени сега</div><div className="num font-display text-lg font-bold sm:text-xl">{done} / {current.length}</div></div></div>
        <div className="panel flex items-center gap-3 p-3 sm:p-4"><Coins className="hidden h-5 w-5 shrink-0 sm:block text-gold-400" /><div><div className="label">Чакащи награди</div><div className="num font-display text-lg font-bold sm:text-xl text-gold-400">{money(waitingCents)}</div></div></div>
        <div className="panel flex items-center gap-3 p-3 sm:p-4"><Star className="hidden h-5 w-5 shrink-0 sm:block text-prestige" /><div><div className="label">Опит за взимане</div><div className="num font-display text-lg font-bold sm:text-xl text-prestige">{int(waiting.reduce((s, r) => s + r.rewardXp, 0))}</div></div></div>
      </div>
      {unclaimed.length > 0 && (
        <Card title={<span className="inline-flex items-center gap-2"><Gift className="h-4 w-4 text-gold-400" />Невзети награди от минали периоди</span>}>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{unclaimed.map((r) => <MissionCard key={`${r.periodKey}:${r.missionId}`} row={r} />)}</ul>
        </Card>
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        {MISSION_PERIODS.map((period) => {
          const w = windows.find((x) => x.period === period)!;
          const rows = current.filter((r) => r.periodKey === w.key);
          const left = Math.max(0, (w.endsAt.getTime() - now.getTime()) / 60_000);
          return (
            <Card
              key={period}
              title={<span className="inline-flex items-center gap-2"><CalendarClock className="h-4 w-4 text-mist-400" />{PERIOD_LABELS[period]} мисии</span>}
              actions={<Badge tone="cyan">остават {duration(left)}</Badge>}
            >
              <p className="mb-3 text-xs text-mist-400">{PERIOD_HINT[period]}</p>
              {rows.length ? <ul className="space-y-3">{rows.map((r) => <MissionCard key={r.missionId} row={r} reroll={reroll} />)}</ul> : <p className="text-sm text-mist-400">Няма мисии за този период.</p>}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

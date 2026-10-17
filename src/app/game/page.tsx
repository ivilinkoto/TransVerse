import { and, eq, gte, sql } from 'drizzle-orm';
import { ArrowRight, ClipboardList, Gauge, Landmark, Route, Star, Target, Truck, TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { EventBanner } from '@/components/events/EventBanner';
import { DailyRewardCard } from '@/components/game/DailyRewardCard';
import { DeliveryProgress } from '@/components/game/DeliveryProgress';
import { Badge, Card, Empty, Meter, PageHeader, Stat } from '@/components/ui';
import { VehicleIllustration } from '@/components/vehicles/VehicleIllustration';
import { dateTime, km, money } from '@/lib/format';
import { ACHIEVEMENTS, levelProgress } from '@/lib/game/progression';
import { achievements, ledgerEntries } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { runningEvents } from '@/server/game/events';
import { missionBoard } from '@/server/game/missions';
import { missionById } from '@/lib/game/missions';
import { companyStats } from '@/server/game/progression';
import { fleetView, latestNotifications, netWorthCents } from '@/server/game/queries';

export default async function OverviewPage() {
  const { db, user, company, now } = await gameContext();
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const [fleet, stats, unlocked, recent, worth, flows, missions, events] = await Promise.all([
    fleetView(db, company.id),
    companyStats(db, company.id),
    db.select().from(achievements).where(eq(achievements.userId, user.id)),
    latestNotifications(db, user.id, 6),
    netWorthCents(db, company.id),
    db
      .select({
        income: sql<number>`coalesce(sum(${ledgerEntries.amountCents}) filter (where ${ledgerEntries.amountCents} > 0 and ${ledgerEntries.category} <> 'starting_capital'), 0)::bigint`,
        expense: sql<number>`coalesce(-sum(${ledgerEntries.amountCents}) filter (where ${ledgerEntries.amountCents} < 0), 0)::bigint`,
      })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.companyId, company.id), gte(ledgerEntries.createdAt, since))),
    missionBoard(db, user.id, now),
    runningEvents(db, user.id, now),
  ]);
  const dailyKey = missions.windows.find((w) => w.period === 'daily')!.key;
  const today = missions.current.filter((m) => m.periodKey === dailyKey);
  const income = Number(flows[0]?.income ?? 0);
  const expense = Number(flows[0]?.expense ?? 0);
  const active = fleet.vehicles.filter((v) => v.delivery);
  const idle = fleet.vehicles.filter((v) => !v.delivery);
  const avgCondition = fleet.vehicles.length ? fleet.vehicles.reduce((s, v) => s + v.condition, 0) / fleet.vehicles.length : 0;
  const lp = levelProgress(user.xp);
  const done = new Set(unlocked.map((a) => a.key));
  const goals = ACHIEVEMENTS.filter((a) => !done.has(a.key)).sort((a, b) => b.progress(stats) - a.progress(stats)).slice(0, 3);

  return (
    <div className="space-y-6">
      <PageHeader title="Обзор" subtitle={company.kind === 'company' ? 'Твоят бизнес и автопарк в реално време. Данните се обновяват автоматично.' : 'Твоят старт като самостоятелен шофьор. Данните се обновяват автоматично.'} actions={<Link href="/game/contracts" className="btn-primary"><ClipboardList className="h-4 w-4" />Поръчки</Link>} />

      <DailyRewardCard streak={user.loginStreak} lastKey={user.dailyClaimKey} now={now} />

      <EventBanner events={events} now={now} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Наличност" value={money(company.balanceCents)} tone={company.balanceCents < 0 ? 'loss' : 'gold'} icon={Landmark} hint={`Нетна стойност ${money(worth)}`} />
        <Stat label="Приходи · 7 дни" value={money(income)} tone="profit" icon={TrendingUp} hint={<>Разходи <span className="text-loss">{money(expense)}</span> · нето {money(income - expense)}</>} />
        <Stat label="Активни доставки" value={`${active.length} / ${fleet.vehicles.length}`} tone="cyan" icon={Route} hint={`${idle.length} свободни превозни средства`} />
        <Stat label="Ниво" value={lp.level} tone="prestige" icon={Star} hint={<><Meter value={lp.share * 100} tone="violet" className="mt-1" /><span className="mt-1 block">{user.xp} / {lp.next} опит · репутация {company.reputation.toFixed(1)}</span></>} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card title="Доставки в момента" actions={<Link href="/game/map" className="text-sm text-cyan-glow hover:underline">На картата →</Link>}>
          {active.length === 0 ? (
            <Empty icon={Truck} title="Няма камиони на път">
              Изберете поръчка от борсата и изпратете свободно превозно средство. <Link href="/game/contracts" className="text-cyan-glow underline">Към поръчките</Link>
            </Empty>
          ) : (
            <ul className="space-y-4">
              {active.map((v) => (
                <li key={v.id} className="flex flex-col gap-3 rounded-xl border border-asphalt-700 bg-asphalt-850 p-3 sm:flex-row sm:items-center">
                  <VehicleIllustration modelId={v.modelId} trailerModelId={v.trailer?.modelId} color={v.color} className="h-12 w-auto max-w-[180px] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold">{v.delivery!.origin.nameBg} → {v.delivery!.destination.nameBg}</span>
                      <Badge tone="blue">{v.delivery!.contract.goods}</Badge>
                      <span className="text-mist-400">{v.plate}</span>
                    </div>
                    <div className="mt-2">
                      <DeliveryProgress schedule={v.delivery!.schedule} etaAt={v.delivery!.etaAt} deadlineAt={v.delivery!.deadlineAt} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card title="Днешни мисии" actions={<Link href="/game/missions" className="text-sm text-cyan-glow hover:underline">Всички мисии →</Link>}>
            <ul className="space-y-3">
              {today.map((m) => {
                const def = missionById(m.missionId);
                return (
                  <li key={m.missionId}>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate">{m.completedAt ? '✓ ' : ''}{def?.title(m.target) ?? m.missionId}</span>
                      <span className="num shrink-0 text-xs text-gold-400">{money(m.rewardCents)}</span>
                    </div>
                    <Meter value={(m.progress / m.target) * 100} tone={m.completedAt ? 'auto' : 'cyan'} className="mt-1" />
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card title="Текущи цели" actions={<Target className="h-4 w-4 text-gold-400" />}>
            <ul className="space-y-3">
              {goals.map((g) => (
                <li key={g.key}>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-semibold">{g.title}</span>
                    <span className="text-xs text-gold-400">{g.rewardCents ? money(g.rewardCents) : ''} {g.rewardXp ? `+${g.rewardXp} опит` : ''}</span>
                  </div>
                  <p className="text-xs text-mist-400">{g.description}</p>
                  <Meter value={g.progress(stats) * 100} tone="gold" className="mt-1.5" />
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Автопарк">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div><div className="num font-display text-xl font-bold">{fleet.vehicles.length}</div><div className="text-xs text-mist-400">превозни средства</div></div>
              <div><div className="num font-display text-xl font-bold">{fleet.trailers.length}</div><div className="text-xs text-mist-400">ремаркета</div></div>
              <div><div className="num font-display text-xl font-bold">{fleet.drivers.length}</div><div className="text-xs text-mist-400">шофьори</div></div>
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-mist-400"><span>Средно техническо състояние</span><span className="num">{avgCondition.toFixed(0)}%</span></div>
            <Meter value={avgCondition} className="mt-1" />
            <div className="mt-3 flex items-center justify-between text-xs text-mist-400"><span>Изминати километри</span><span className="num">{km(stats.totalKm)}</span></div>
            <Link href="/game/fleet" className="mt-4 inline-flex items-center gap-1 text-sm text-cyan-glow hover:underline">Управление <ArrowRight className="h-3.5 w-3.5" /></Link>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Последни събития" actions={<Link href="/game/notifications" className="text-sm text-cyan-glow hover:underline">Всички</Link>}>
          <ul className="space-y-3">
            {recent.map((n) => (
              <li key={n.id} className="flex gap-3 text-sm">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.kind === 'success' ? 'bg-profit' : n.kind === 'warning' ? 'bg-amber-sig' : n.kind === 'achievement' ? 'bg-prestige' : 'bg-volt-400'}`} />
                <div className="min-w-0">
                  <div className="font-semibold">{n.title}</div>
                  <div className="text-mist-400">{n.body}</div>
                  <div className="text-[11px] text-mist-400">{dateTime(n.createdAt)}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Възможности">
          <ul className="space-y-2 text-sm">
            {idle.length > 0 && <li className="flex items-center gap-2"><Gauge className="h-4 w-4 text-cyan-glow" />{idle.length} свободни превозни средства чакат поръчка. <Link className="text-cyan-glow underline" href="/game/contracts">Изпрати ги</Link></li>}
            {fleet.vehicles.some((v) => v.condition < 50) && <li className="flex items-center gap-2"><TrendingDown className="h-4 w-4 text-amber-sig" />Има техника под 50% състояние. <Link className="text-cyan-glow underline" href="/game/garage">Ремонт</Link></li>}
            {company.balanceCents > 80_000_00 && <li className="flex items-center gap-2"><Truck className="h-4 w-4 text-profit" />Имате средства за нов камион. <Link className="text-cyan-glow underline" href="/game/market">Към пазара</Link></li>}
            <li className="flex items-center gap-2"><Star className="h-4 w-4 text-prestige" />Ниво {lp.level + 1} отключва нови видове товари и техника. <Link className="text-cyan-glow underline" href="/game/progress">Прогрес</Link></li>
          </ul>
          <p className="mt-4 text-xs text-mist-400">Последни доставки: {stats.deliveries} · навреме {stats.onTimeDeliveries}</p>
        </Card>
      </div>
    </div>
  );
}

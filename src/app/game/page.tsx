import { and, eq, gte, sql } from 'drizzle-orm';
import { ChevronRight, ClipboardList, GraduationCap, Landmark, Map as MapIcon, Newspaper, Route, Star, Truck, TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { EventBanner } from '@/components/events/EventBanner';
import { DailyRewardCard } from '@/components/game/DailyRewardCard';
import { headline } from '@/lib/game/news';
import { latestIssues } from '@/server/game/news';
import { ChristmasTreeIcon, PumpkinIcon } from '@/components/seasonal/icons';
import { CHRISTMAS, isChristmas } from '@/lib/game/christmas';
import { HALLOWEEN, isHalloween } from '@/lib/game/halloween';
import { isWinter } from '@/lib/game/winter';
import { RoadConditions } from '@/components/game/RoadConditions';
import { isNewcomer, MENTOR } from '@/lib/game/mentor';
import { mentorOverview } from '@/server/game/mentor';
import { countries as countryTable } from '@/server/db/schema';
import { DeliveryProgress } from '@/components/game/DeliveryProgress';
import { Badge, Card, Empty, Meter } from '@/components/ui';
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
  const [paper] = await latestIssues(db, 1);
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const [fleet, stats, unlocked, recent, worth, flows, missions, events] = await Promise.all([
    fleetView(db, company.id),
    companyStats(db, company.id),
    db.select().from(achievements).where(eq(achievements.userId, user.id)),
    latestNotifications(db, user.id, 5),
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

  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Sofia' }).format(now));
  const greeting = hour < 11 ? 'Добро утро' : hour < 18 ? 'Добър ден' : 'Добър вечер';
  const worn = fleet.vehicles.filter((v) => v.condition < 50 && !v.delivery);
  const next =
    fleet.vehicles.length === 0
      ? { text: 'Нямаш превозно средство. Купи първото си и започни да печелиш.', href: '/game/market', cta: 'Към пазара', icon: Truck }
      : idle.length > 0
        ? { text: idle.length === 1 ? 'Имаш свободно превозно средство — намери му поръчка.' : `${idle.length} свободни превозни средства чакат поръчка.`, href: '/game/contracts', cta: 'Намери поръчка', icon: ClipboardList }
        : { text: 'Всички превозни средства са на път. Проследи ги на картата.', href: '/game/map', cta: 'Към картата', icon: MapIcon };
  const hero = fleet.vehicles[0];

  return (
    <div className="space-y-5 sm:space-y-6">
      <section className="panel relative overflow-hidden p-5 sm:p-6">
        <div className="road-grid pointer-events-none absolute inset-0 opacity-60 [mask-image:linear-gradient(to_left,black,transparent_70%)]" aria-hidden="true" />
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-volt-500/20 blur-3xl" aria-hidden="true" />
        <div className="relative flex flex-col gap-5 md:flex-row md:items-center">
          <div className="min-w-0 flex-1">
            <h1 className="label text-cyan-glow">Табло</h1>
            <p className="mt-1 font-display text-2xl font-bold sm:text-3xl">{greeting}, {user.username}</p>
            <p className="mt-2 max-w-xl text-mist-300">{next.text}</p>
            {worn.length > 0 && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-amber-sig"><TrendingDown className="h-4 w-4" />{worn.length === 1 ? 'Едно превозно средство е' : `${worn.length} превозни средства са`} под 50% състояние. <Link href="/game/garage" className="underline">Към сервиза</Link></p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={next.href} className="btn-primary"><next.icon className="h-4 w-4" />{next.cta}</Link>
              {next.href !== '/game/map' && fleet.vehicles.length > 0 && <Link href="/game/map" className="btn-ghost"><MapIcon className="h-4 w-4" />Карта</Link>}
            </div>
          </div>
          {hero && (
            <div className="hidden shrink-0 md:block">
              <VehicleIllustration modelId={hero.modelId} trailerModelId={hero.trailer?.modelId} color={hero.color} livery={hero.livery} className="h-24 w-auto max-w-[340px] drop-shadow-[0_18px_24px_rgba(0,0,0,0.55)] lg:h-28" />
            </div>
          )}
        </div>
        <dl className="relative mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-asphalt-700/80 bg-asphalt-700/60 md:grid-cols-4">
          <div className="bg-asphalt-900/90 p-3">
            <dt className="label flex items-center gap-1.5"><Landmark className="h-3.5 w-3.5 text-gold-400" />Наличност</dt>
            <dd className={`num mt-1 font-display text-lg font-bold sm:text-xl ${company.balanceCents < 0 ? 'text-loss' : 'text-gold-400'}`}>{money(company.balanceCents)}</dd>
            <dd className="text-[11px] text-mist-400">нетна стойност {money(worth)}</dd>
          </div>
          <div className="bg-asphalt-900/90 p-3">
            <dt className="label flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5 text-profit" />Нето · 7 дни</dt>
            <dd className={`num mt-1 font-display text-lg font-bold sm:text-xl ${income - expense < 0 ? 'text-loss' : 'text-profit'}`}>{money(income - expense)}</dd>
            <dd className="text-[11px] text-mist-400">приходи {money(income)}</dd>
          </div>
          <div className="bg-asphalt-900/90 p-3">
            <dt className="label flex items-center gap-1.5"><Route className="h-3.5 w-3.5 text-cyan-glow" />На път</dt>
            <dd className="num mt-1 font-display text-lg font-bold text-cyan-glow sm:text-xl">{active.length} / {fleet.vehicles.length}</dd>
            <dd className="text-[11px] text-mist-400">състояние {avgCondition.toFixed(0)}% · {km(stats.totalKm)}</dd>
          </div>
          <div className="bg-asphalt-900/90 p-3">
            <dt className="label flex items-center gap-1.5"><Star className="h-3.5 w-3.5 text-prestige" />Ниво {lp.level}</dt>
            <dd className="mt-2"><Meter value={lp.share * 100} tone="violet" /></dd>
            <dd className="num mt-1.5 text-[11px] text-mist-400">{user.xp} / {lp.next} опит · реп. {company.reputation.toFixed(1)}</dd>
          </div>
        </dl>
      </section>

      {isHalloween(now) && (
        <Link href="/game/halloween" className="panel group flex items-center gap-4 border-orange-500/40 p-4 transition hover:border-orange-500/80">
          <PumpkinIcon className="h-11 w-11 shrink-0 transition group-hover:scale-110" />
          <span className="min-w-0 flex-1">
            <span className="block font-display font-bold">Нощта на тиквите</span>
            <span className="block text-sm text-mist-300">Празнични поръчки с +{Math.round((HALLOWEEN.rewardMultiplier - 1) * 100)}%, общ ивент, хелуински мисии и значка, призрачен камион нощем.</span>
          </span>
          <span className="btn-primary max-sm:hidden">Към празника</span>
        </Link>
      )}
      {isChristmas(now) && (
        <Link href="/game/christmas" className="panel group flex items-center gap-4 border-red-500/40 p-4 transition hover:border-red-500/80">
          <ChristmasTreeIcon className="h-11 w-11 shrink-0 transition group-hover:scale-110" />
          <span className="min-w-0 flex-1">
            <span className="block font-display font-bold">Коледна треска</span>
            <span className="block text-sm text-mist-300">Коледни поръчки с +{Math.round((CHRISTMAS.rewardMultiplier - 1) * 100)}%, подаръци до Бъдни вечер, коледни мисии, значка и празнична боя.</span>
          </span>
          <span className="btn-primary max-sm:hidden">Към празника</span>
        </Link>
      )}
      {isNewcomer(user, now) && !(await mentorOverview(db, user.id, now)).mentor && (
        <Link href="/game/mentor" className="panel group flex items-center gap-3 p-3.5 transition hover:border-asphalt-500">
          <GraduationCap className="h-6 w-6 shrink-0 text-cyan-glow" />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Избери си наставник</span>
            <span className="block text-sm text-mist-300">Опитен шофьор те води до ниво {MENTOR.goalLevel}: +{Math.round(MENTOR.xpBonus * 100)} % опит, а накрая награда и за двамата.</span>
          </span>
        </Link>
      )}
      {isWinter(now) && <RoadConditions countries={await db.select({ code: countryTable.code, nameBg: countryTable.nameBg }).from(countryTable).orderBy(countryTable.nameBg)} now={now} />}
      {paper && (
        <Link href="/game/news" className="panel group flex items-center gap-3 p-3.5 transition hover:border-asphalt-500">
          <Newspaper className="h-6 w-6 shrink-0 text-mist-300" />
          <span className="min-w-0 flex-1">
            <span className="label block">Седмичник · брой {paper.number}</span>
            <span className="block truncate font-medium">{headline(paper.content)}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-mist-400 transition group-hover:translate-x-0.5" />
        </Link>
      )}
      <DailyRewardCard streak={user.loginStreak} lastKey={user.dailyClaimKey} now={now} />

      <EventBanner events={events} now={now} />

      <div className="grid gap-5 sm:gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5 sm:space-y-6">
          <Card title="На път сега" actions={active.length > 0 && <Link href="/game/map" className="text-sm text-cyan-glow hover:underline">На картата →</Link>}>
            {active.length === 0 ? (
              <Empty icon={Truck} title="Няма камиони на път">
                Избери поръчка и изпрати свободно превозно средство. <Link href="/game/contracts" className="text-cyan-glow underline">Към поръчките</Link>
              </Empty>
            ) : (
              <ul className="space-y-3">
                {active.map((v) => (
                  <li key={v.id} className="flex flex-col gap-3 rounded-xl border border-asphalt-700/80 bg-asphalt-850/80 p-3 sm:flex-row sm:items-center">
                    <VehicleIllustration modelId={v.modelId} trailerModelId={v.trailer?.modelId} color={v.color} livery={v.livery} className="h-11 w-auto max-w-[170px] shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <span className="font-semibold">{v.delivery!.origin.nameBg} → {v.delivery!.destination.nameBg}</span>
                        <Badge tone="blue">{v.delivery!.contract.goods}</Badge>
                        <span className="text-xs text-mist-400">{v.plate}</span>
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

        </div>

        <div className="space-y-5 sm:space-y-6">
          <Card title="Днешни мисии" actions={<Link href="/game/missions" className="text-sm text-cyan-glow hover:underline">Всички →</Link>}>
            <ul className="space-y-3">
              {today.map((m) => {
                const def = missionById(m.missionId);
                return (
                  <li key={m.missionId}>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className={`min-w-0 truncate ${m.completedAt ? 'text-profit' : ''}`}>{m.completedAt ? '✓ ' : ''}{def?.title(m.target) ?? m.missionId}</span>
                      <span className="num shrink-0 text-xs text-gold-400">{money(m.rewardCents)}</span>
                    </div>
                    <Meter value={(m.progress / m.target) * 100} tone={m.completedAt ? 'auto' : 'cyan'} className="mt-1" />
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card title="Следващи цели" actions={<Link href="/game/progress" className="text-sm text-cyan-glow hover:underline">Постижения →</Link>}>
            <ul className="space-y-3">
              {goals.map((g) => (
                <li key={g.key}>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-semibold">{g.title}</span>
                    <span className="shrink-0 text-xs text-gold-400">{g.rewardCents ? money(g.rewardCents) : ''} {g.rewardXp ? `+${g.rewardXp} опит` : ''}</span>
                  </div>
                  <p className="text-xs text-mist-400">{g.description}</p>
                  <Meter value={g.progress(stats) * 100} tone="gold" className="mt-1.5" />
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Последни събития" actions={<Link href="/game/notifications" className="text-sm text-cyan-glow hover:underline">Всички →</Link>}>
            {recent.length === 0 ? (
              <p className="text-sm text-mist-400">Още няма събития.</p>
            ) : (
              <ul className="divide-y divide-asphalt-800">
                {recent.map((n) => (
                  <li key={n.id} className="flex gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.kind === 'success' ? 'bg-profit' : n.kind === 'warning' ? 'bg-amber-sig' : n.kind === 'achievement' ? 'bg-prestige' : 'bg-volt-400'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="font-semibold">{n.title}</span>
                        <span className="text-[11px] text-mist-400">{dateTime(n.createdAt)}</span>
                      </div>
                      <div className="text-mist-400">{n.body}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

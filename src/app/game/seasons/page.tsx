import { and, desc, eq } from 'drizzle-orm';
import { CalendarClock, Trophy } from 'lucide-react';
import Link from 'next/link';
import { Card, Meter, PageHeader, Segmented, Stat } from '@/components/ui';
import { date, int, money } from '@/lib/format';
import { seasonScores, seasons } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { leaderboard } from '@/server/game/queries';
import { companyPrizes, organizationSeasonResults, organizationSeasonTable, type SeasonRules } from '@/server/game/seasons';
import { membershipOf } from '@/server/game/membership';

export const metadata = { title: 'Сезони' };

export default async function SeasonsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { db, user, company, now } = await gameContext();
  const tab = (await searchParams).tab === 'companies' ? 'companies' : 'players';
  const { season, rows } = await leaderboard(db, 'season', 200);
  const rules = season!.rules as SeasonRules;
  const myIndex = rows.findIndex((r) => r.companyId === company.id);
  const total = season!.endsAt.getTime() - season!.startsAt.getTime();
  const elapsed = Math.min(1, (now.getTime() - season!.startsAt.getTime()) / total);
  const daysLeft = Math.max(0, Math.ceil((season!.endsAt.getTime() - now.getTime()) / 86_400_000));
  const past = await db.select().from(seasons).where(eq(seasons.status, 'finished')).orderBy(desc(seasons.id)).limit(6);
  const myPast = past.length ? await db.select().from(seasonScores).where(and(eq(seasonScores.companyId, company.id))) : [];
  const membership = await membershipOf(db, user.id);
  const orgRows = await organizationSeasonTable(db, season!.id, 100);
  const myOrgIndex = membership ? orgRows.findIndex((r) => r.organizationId === membership.company.id) : -1;
  const orgPast = membership && past.length ? await organizationSeasonResults(db, membership.company.id) : [];
  const companies = tab === 'companies';
  const prizes = companies ? companyPrizes(rules) : rules.prizesCents;

  return (
    <div className="space-y-6">
      <PageHeader title={season!.name} subtitle="Сезонно класиране с награди за първите места."
        help="Сезонните точки идват от доставки (километри × тонаж, повече за навреме). В края на сезона първите играчи получават пари, а първите компании — награда в касата и значка в профила. Парите, техниката и компаниите остават." />
      <Segmented label="Класация" active={tab} items={[{ id: 'players', label: 'Играчи', href: '/game/seasons' }, { id: 'companies', label: 'Компании', href: '/game/seasons?tab=companies' }]} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
        <Stat label="Остават" value={`${daysLeft} дни`} icon={CalendarClock} tone="cyan" hint={`${date(season!.startsAt)} – ${date(season!.endsAt)}`} />
        {companies ? (
          <Stat label="Твоята компания" value={myOrgIndex >= 0 ? `#${myOrgIndex + 1}` : '—'} icon={Trophy} tone="gold" hint={membership ? (myOrgIndex >= 0 ? `${int(orgRows[myOrgIndex]!.points)} точки` : 'Първата доставка на член ви вкарва в класацията') : 'Не си член на компания'} />
        ) : (
          <Stat label="Твоето място" value={myIndex >= 0 ? `#${myIndex + 1}` : '—'} icon={Trophy} tone="gold" hint={myIndex >= 0 ? `${int(rows[myIndex]!.value)} точки` : 'Направи доставка, за да влезеш в класацията'} />
        )}
        <Stat label="Награден фонд" value={money(prizes.reduce((a, b) => a + b, 0))} tone="prestige" hint={companies ? `в касите на първите ${prizes.length} компании` : `за първите ${prizes.length} места`} />
      </div>
      <Card><div className="flex justify-between text-xs text-mist-400"><span>Ход на сезона</span><span className="num">{Math.round(elapsed * 100)}%</span></div><Meter value={elapsed * 100} tone="cyan" className="mt-2" /></Card>
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card title={companies ? 'Класация на компаниите' : 'Класация на играчите'} className="p-2 sm:p-3">
          <ol className="divide-y divide-asphalt-800">
            {companies
              ? orgRows.slice(0, 50).map((r, i) => (
                  <li key={r.organizationId} className={`flex items-center gap-3 rounded-xl px-2 py-2.5 sm:px-3 ${r.organizationId === membership?.company.id ? 'bg-volt-500/10 ring-1 ring-volt-500/30' : ''}`}>
                    <span className="num w-8 shrink-0 text-center font-display font-bold text-mist-300">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <Link href={`/game/companies/${r.organizationId}`} className="block truncate font-semibold hover:underline">{r.tag && <span style={{ color: r.color ?? undefined }}>[{r.tag}] </span>}{r.name}</Link>
                      <div className="text-xs text-mist-400">ниво {r.level} · {int(r.members)} членове · {int(r.deliveries)} доставки</div>
                    </div>
                    <div className="shrink-0 text-right"><div className="num font-display font-bold text-gold-400">{int(r.points)}</div><div className="text-[11px] text-mist-400">точки</div></div>
                  </li>
                ))
              : rows.slice(0, 50).map((r, i) => (
                  <li key={r.companyId} className={`flex items-center gap-3 rounded-xl px-2 py-2.5 sm:px-3 ${r.companyId === company.id ? 'bg-volt-500/10 ring-1 ring-volt-500/30' : ''}`}>
                    <span className="num w-8 shrink-0 text-center font-display font-bold text-mist-300">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{r.owner}</div>
                      <div className="truncate text-xs text-mist-400">{r.company} · ниво {r.level} · {int(r.deliveries)} доставки</div>
                    </div>
                    <div className="shrink-0 text-right"><div className="num font-display font-bold text-gold-400">{int(r.value)}</div><div className="text-[11px] text-mist-400">точки</div></div>
                  </li>
                ))}
          </ol>
          {(companies ? orgRows : rows).length === 0 && <p className="p-3 text-sm text-mist-400">{companies ? 'Още никоя компания няма точки този сезон.' : 'Никой още не е натрупал точки този сезон.'}</p>}
        </Card>
        <div className="space-y-6">
          <Card title="Награди">
            <ol className="space-y-2 text-sm">
              {prizes.map((p, i) => <li key={i} className="flex justify-between rounded-lg bg-asphalt-850 px-3 py-2"><span>{i + 1}. място</span><span className="num text-gold-400">{money(p)}</span></li>)}
            </ol>
            {companies && <p className="mt-3 text-xs text-mist-400">Наградите отиват в касата на компанията. Точките на компанията са сборът от сезонните точки на членовете ѝ, спечелени докато са членове.</p>}
          </Card>
          <Card title="Минали сезони">
            {past.length === 0 ? <p className="text-sm text-mist-400">Това е първият сезон.</p> : (
              <ul className="space-y-2 text-sm">
                {past.map((s) => {
                  const mine = companies ? orgPast.find((m) => m.seasonId === s.id) : myPast.find((m) => m.seasonId === s.id);
                  const rank = mine && ('rank' in mine ? mine.rank : mine.finalRank);
                  return <li key={s.id} className="flex justify-between rounded-lg bg-asphalt-850 px-3 py-2"><span>{s.name}</span><span className="text-mist-400">{rank ? `#${rank} · ${int(mine!.points)} т.` : 'без участие'}</span></li>;
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

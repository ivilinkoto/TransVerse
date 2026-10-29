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
import { COMPANY_MEDAL_PLACES, MEDAL_INFO, PLAYER_MEDAL_PLACES, companyMedal, playerMedal } from '@/lib/game/medals';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Сезони') };
}

export default async function SeasonsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await initLocale();
  const { db, user, company, now, features } = await gameContext();
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
  // 1.1.3.1: the medal the place would win if the season ended now.
  const medalIcon = (place: number) => {
    const m = features.season_medals ? (companies ? companyMedal(place) : playerMedal(place)) : null;
    return m ? <span className="ml-1" title={tx(MEDAL_INFO[m].label)}>{MEDAL_INFO[m].icon}</span> : null;
  };

  return (
    <div className="space-y-6">
      <PageHeader title={tx(season!.name)} subtitle={t('Сезонно класиране с награди за първите места.')}
        help={t('Сезонните точки идват от доставки (километри × тонаж, повече за навреме). В края на сезона първите играчи получават пари, а първите компании — награда в касата и значка в профила. Парите, техниката и компаниите остават.')} />
      <Segmented label={t('Класация')} active={tab} items={[{ id: 'players', label: t('Играчи'), href: '/game/seasons' }, { id: 'companies', label: t('Компании'), href: '/game/seasons?tab=companies' }]} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
        <Stat label={t('Остават')} value={t('{0} дни', daysLeft)} icon={CalendarClock} tone="cyan" hint={`${date(season!.startsAt)} – ${date(season!.endsAt)}`} />
        {companies ? (
          <Stat label={t('Твоята компания')} value={myOrgIndex >= 0 ? `#${myOrgIndex + 1}` : '—'} icon={Trophy} tone="gold" hint={membership ? (myOrgIndex >= 0 ? t('{0} точки', int(orgRows[myOrgIndex]!.points)) : t('Първата доставка на член ви вкарва в класацията')) : t('Не си член на компания')} />
        ) : (
          <Stat label={t('Твоето място')} value={myIndex >= 0 ? `#${myIndex + 1}` : '—'} icon={Trophy} tone="gold" hint={myIndex >= 0 ? t('{0} точки', int(rows[myIndex]!.value)) : t('Направи доставка, за да влезеш в класацията')} />
        )}
        <Stat label={t('Награден фонд')} value={money(prizes.reduce((a, b) => a + b, 0))} tone="prestige" hint={companies ? t('в касите на първите {0} компании', prizes.length) : t('за първите {0} места', prizes.length)} />
      </div>
      <Card><div className="flex justify-between text-xs text-mist-400"><span>{t('Ход на сезона')}</span><span className="num">{Math.round(elapsed * 100)}%</span></div><Meter value={elapsed * 100} tone="cyan" className="mt-2" /></Card>
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card title={companies ? t('Класация на компаниите') : t('Класация на играчите')} className="p-2 sm:p-3">
          <ol className="divide-y divide-asphalt-800">
            {companies
              ? orgRows.slice(0, 50).map((r, i) => (
                  <li key={r.organizationId} className={`flex items-center gap-3 rounded-xl px-2 py-2.5 sm:px-3 ${r.organizationId === membership?.company.id ? 'bg-volt-500/10 ring-1 ring-volt-500/30' : ''}`}>
                    <span className="num w-12 shrink-0 text-center font-display font-bold text-mist-300">{i + 1}{medalIcon(i + 1)}</span>
                    <div className="min-w-0 flex-1">
                      <Link href={`/game/companies/${r.organizationId}`} className="block truncate font-semibold hover:underline">{r.tag && <span style={{ color: r.color ?? undefined }}>[{tx(r.tag)}] </span>}{tx(r.name)}</Link>
                      <div className="text-xs text-mist-400">{t('ниво {0} · {1} членове · {2} доставки', r.level, int(r.members), int(r.deliveries))}</div>
                    </div>
                    <div className="shrink-0 text-right"><div className="num font-display font-bold text-gold-400">{int(r.points)}</div><div className="text-[11px] text-mist-400">{t('точки')}</div></div>
                  </li>
                ))
              : rows.slice(0, 50).map((r, i) => (
                  <li key={r.companyId} className={`flex items-center gap-3 rounded-xl px-2 py-2.5 sm:px-3 ${r.companyId === company.id ? 'bg-volt-500/10 ring-1 ring-volt-500/30' : ''}`}>
                    <span className="num w-12 shrink-0 text-center font-display font-bold text-mist-300">{i + 1}{medalIcon(i + 1)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{tx(r.owner)}</div>
                      <div className="truncate text-xs text-mist-400">{t('{0} · ниво {1} · {2} доставки', r.company, r.level, int(r.deliveries))}</div>
                    </div>
                    <div className="shrink-0 text-right"><div className="num font-display font-bold text-gold-400">{int(r.value)}</div><div className="text-[11px] text-mist-400">{t('точки')}</div></div>
                  </li>
                ))}
          </ol>
          {(companies ? orgRows : rows).length === 0 && <p className="p-3 text-sm text-mist-400">{companies ? t('Още никоя компания няма точки този сезон.') : t('Никой още не е натрупал точки този сезон.')}</p>}
        </Card>
        <div className="space-y-6">
          <Card title={t('Награди')}>
            <ol className="space-y-2 text-sm">
              {prizes.map((p, i) => <li key={i} className="flex justify-between rounded-lg bg-asphalt-850 px-3 py-2"><span>{t('{0}. място', i + 1)}</span><span className="num text-gold-400">{money(p)}</span></li>)}
            </ol>
            {features.season_medals && (
              <p className="mt-3 rounded-lg border border-gold-400/30 bg-gold-400/5 px-3 py-2 text-xs text-mist-300">
                {companies
                  ? t('Медали за компаниите: 🥇 {0}. място, 🥈 {1}. място, 🥉 {2}. място — като значки на профила на компанията и за всеки член.', COMPANY_MEDAL_PLACES.gold, COMPANY_MEDAL_PLACES.silver, COMPANY_MEDAL_PLACES.bronze)
                  : t('Медали за играчите: 🥇 места 1–{0}, 🥈 места {1}–{2}, 🥉 места {3}–{4} — в профила и витрината ти.', PLAYER_MEDAL_PLACES.gold, PLAYER_MEDAL_PLACES.gold + 1, PLAYER_MEDAL_PLACES.silver, PLAYER_MEDAL_PLACES.silver + 1, PLAYER_MEDAL_PLACES.bronze)}
              </p>
            )}
            {companies && <p className="mt-3 text-xs text-mist-400">{t('Наградите отиват в касата на компанията. Точките на компанията са сборът от сезонните точки на членовете ѝ, спечелени докато са членове.')}</p>}
          </Card>
          <Card title={t('Минали сезони')}>
            {past.length === 0 ? <p className="text-sm text-mist-400">{t('Това е първият сезон.')}</p> : (
              <ul className="space-y-2 text-sm">
                {past.map((s) => {
                  const mine = companies ? orgPast.find((m) => m.seasonId === s.id) : myPast.find((m) => m.seasonId === s.id);
                  const rank = mine && ('rank' in mine ? mine.rank : mine.finalRank);
                  return <li key={s.id} className="flex justify-between rounded-lg bg-asphalt-850 px-3 py-2"><span>{tx(s.name)}</span><span className="text-mist-400">{rank ? t('#{0} · {1} т.', rank, int(mine!.points)) : t('без участие')}</span></li>;
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

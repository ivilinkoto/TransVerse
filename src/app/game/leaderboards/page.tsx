import Link from 'next/link';
import { topBases } from '@/server/game/plot';
import { Card, PageHeader, Segmented } from '@/components/ui';
import { hasUnlock } from '@/lib/game/company';
import { isVip } from '@/lib/game/vip';
import { PlayerName } from '@/components/game/PlayerName';
import { int, money } from '@/lib/format';
import { gameContext } from '@/server/game/context';
import { membershipOf } from '@/server/game/membership';
import { companyLeaderboard, leaderboard, nationalBoard, nationalTable, type LeaderboardKind } from '@/server/game/queries';
import { countries } from '@/server/db/schema';
import { ECO } from '@/lib/game/eco';
import { ecoBoard, ecoWeek } from '@/server/game/eco';
import { DIVISION_LABELS, DIVISION_RULES, DIVISIONS } from '@/lib/game/competition';
import { divisionTable } from '@/server/game/competition';
import { LANE_RECORDS } from '@/lib/game/community';
import { laneRecordsView } from '@/server/game/community';
import { t as tr, tx, intlLocale } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Класации') };
}

const TABS: { id: LeaderboardKind | 'eco' | 'bases' | 'divisions' | 'records' | 'nations'; label: string; unit: string }[] = [
  { id: 'season', label: 'Сезон', unit: 'точки' },
  { id: 'wealth', label: 'Богатство', unit: 'стойност' },
  { id: 'deliveries', label: 'Доставки', unit: 'доставки' },
  { id: 'companies', label: 'Компании', unit: 'опит' },
  { id: 'eco', label: 'Икономичен шофьор', unit: 'лв./км' },
  { id: 'bases', label: 'Най-красиви бази', unit: 'харесвания' },
  { id: 'divisions', label: 'Дивизии', unit: 'тонове' },
  { id: 'records', label: 'Рекорди на линии', unit: 'време' },
  { id: 'nations', label: 'Държави', unit: 'точки' },
];

/** The flag emoji of a country code. */
const flag = (code: string) => String.fromCodePoint(...[...code.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));

const medal = (i: number) => (i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1);

export default async function LeaderboardsPage({ searchParams }: { searchParams: Promise<{ tab?: string; country?: string }> }) {
  await initLocale();
  const { db, user, company, features } = await gameContext();
  const tabs = TABS.filter((t) => (t.id !== 'eco' || features.eco) && (t.id !== 'bases' || features.plot_guests) && (t.id !== 'divisions' || features.divisions) && (t.id !== 'records' || features.lane_records) && (t.id !== 'nations' || features.national_rankings));
  const params = await searchParams;
  const requested = params.tab;
  const tab = tabs.find((t) => t.id === requested) ?? tabs[0]!;
  return (
    <div className="space-y-5">
      <PageHeader title={tr('Класации')} subtitle={tr('Само реални играчи и техните компании. Няма измислени конкуренти.')} />
      <Segmented label={tr('Вид класация')} active={tab.id} items={tabs.map((t) => ({ id: t.id, label: t.label, href: `/game/leaderboards?tab=${t.id}` }))} />
      {tab.id === 'nations' ? <NationsBoard country={params.country?.toUpperCase().slice(0, 2)} companyId={company.id} /> : tab.id === 'records' ? <RecordsBoard /> : tab.id === 'divisions' ? <DivisionsBoard userId={user.id} /> : tab.id === 'bases' ? <BasesBoard userId={user.id} /> : tab.id === 'eco' ? <EcoBoardView userId={user.id} /> : tab.id === 'companies' ? <CompanyBoard userId={user.id} /> : <PlayerBoard kind={tab.id} unit={tx(tab.unit)} companyId={company.id} />}
    </div>
  );
}

async function PlayerBoard({ kind, unit, companyId }: { kind: Exclude<LeaderboardKind, 'companies'>; unit: string; companyId: string }) {
  const { db, now } = await gameContext();
  const { rows } = await leaderboard(db, kind, 100);
  return (
    <Card className="p-2 sm:p-3">
      <ol className="divide-y divide-asphalt-800">
        {rows.map((r, i) => (
          <li key={r.companyId} className={`flex items-center gap-3 rounded-xl px-2 py-2.5 sm:px-3 ${r.companyId === companyId ? 'bg-volt-500/10 ring-1 ring-volt-500/30' : ''}`}>
            <span className="num w-8 shrink-0 text-center font-display font-bold text-mist-300">{medal(i)}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{tx(r.company)}</div>
              <div className="flex items-center gap-2 text-xs text-mist-400"><PlayerName name={r.owner} role={r.ownerRole} vip={isVip(r.ownerVipUntil, now)} /><span>{tr('· ниво {0}', r.level)}</span></div>
            </div>
            <div className="shrink-0 text-right">
              <div className="num font-display font-bold text-gold-400">{kind === 'wealth' ? money(r.value) : int(r.value)}</div>
              <div className="text-[11px] text-mist-400">{unit}</div>
            </div>
          </li>
        ))}
      </ol>
      {rows.length === 0 && <p className="p-3 text-sm text-mist-400">{tr('Все още няма данни.')}</p>}
    </Card>
  );
}

async function CompanyBoard({ userId }: { userId: string }) {
  const { db, now } = await gameContext();
  const [rows, mine] = await Promise.all([companyLeaderboard(db, 100), membershipOf(db, userId)]);
  return (
    <Card className="p-2 sm:p-3">
      <ol className="divide-y divide-asphalt-800">
        {rows.map((r, i) => (
          <li key={r.companyId} className={`flex items-center gap-3 rounded-xl px-2 py-2.5 sm:px-3 ${r.companyId === mine?.company.id ? 'bg-volt-500/10 ring-1 ring-volt-500/30' : ''}`}>
            <span className="num w-8 shrink-0 text-center font-display font-bold text-mist-300">{medal(i)}</span>
            <div className="min-w-0 flex-1">
              <Link href={`/game/companies/${r.companyId}`} className="block truncate font-semibold hover:underline">
                {r.tag && hasUnlock(r.level, 'tag') && <span style={{ color: r.color ?? undefined }}>[{tx(r.tag)}] </span>}
                {tx(r.company)}
              </Link>
              <div className="flex flex-wrap items-center gap-x-2 text-xs text-mist-400"><PlayerName name={r.owner} role={r.ownerRole} vip={isVip(r.ownerVipUntil, now)} /><span>{tr('· ниво {0} · {1} членове', r.level, int(r.members))}</span></div>
            </div>
            <div className="shrink-0 text-right">
              <div className="num font-display font-bold text-gold-400">{int(r.value)}</div>
              <div className="text-[11px] text-mist-400">{tr('опит')}</div>
            </div>
          </li>
        ))}
      </ol>
      {rows.length === 0 && <p className="p-3 text-sm text-mist-400">{tr('Все още няма основани компании.')}</p>}
    </Card>
  );
}

/** v2.0: national rankings — the countries by their companies' season points, and the companies of one country. */
async function NationsBoard({ country, companyId }: { country?: string; companyId: string }) {
  const { db, now } = await gameContext();
  const [{ rows }, names] = await Promise.all([nationalTable(db), db.select({ code: countries.code, nameBg: countries.nameBg }).from(countries)]);
  const name = (code: string) => tx(names.find((n) => n.code === code)?.nameBg ?? code);
  const board = country ? await nationalBoard(db, country, 50) : null;
  return (
    <div className="space-y-4">
      <p className="text-sm text-mist-300">{tr('Сезонните точки на компаниите, събрани по държавата на базата им. Избери държава, за да видиш нейната класация.')}</p>
      <Card className="p-2 sm:p-3">
        <ol className="divide-y divide-asphalt-800">
          {rows.map((r, i) => (
            <li key={r.country}>
              <Link href={`/game/leaderboards?tab=nations&country=${r.country}`} className={`flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-asphalt-800/60 sm:px-3 ${r.country === country ? 'bg-volt-500/10 ring-1 ring-volt-500/30' : ''}`}>
                <span className="num w-8 shrink-0 text-center font-display font-bold text-mist-300">{medal(i)}</span>
                <span className="text-xl" aria-hidden>{flag(r.country)}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{name(r.country)}</div>
                  <div className="text-xs text-mist-400">{tr('Компании: {0}', int(r.companies))}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="num font-display font-bold text-gold-400">{int(r.points)}</div>
                  <div className="text-[11px] text-mist-400">{tr('точки')}</div>
                </div>
              </Link>
            </li>
          ))}
        </ol>
        {rows.length === 0 && <p className="p-3 text-sm text-mist-400">{tr('Все още няма данни.')}</p>}
      </Card>
      {board && country && (
        <Card className="p-2 sm:p-3">
          <h2 className="px-2 pb-2 font-display font-bold sm:px-3">{flag(country)} {name(country)}</h2>
          <ol className="divide-y divide-asphalt-800">
            {board.rows.map((r, i) => (
              <li key={r.companyId} className={`flex items-center gap-3 rounded-xl px-2 py-2.5 sm:px-3 ${r.companyId === companyId ? 'bg-volt-500/10 ring-1 ring-volt-500/30' : ''}`}>
                <span className="num w-8 shrink-0 text-center font-display font-bold text-mist-300">{medal(i)}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{tx(r.company)}</div>
                  <div className="flex items-center gap-2 text-xs text-mist-400"><PlayerName name={r.owner} role={r.ownerRole} vip={isVip(r.ownerVipUntil, now)} /><span>{tr('· ниво {0}', r.level)}</span></div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="num font-display font-bold text-gold-400">{int(r.value)}</div>
                  <div className="text-[11px] text-mist-400">{tr('точки')}</div>
                </div>
              </li>
            ))}
          </ol>
          {board.rows.length === 0 && <p className="p-3 text-sm text-mist-400">{tr('Все още няма данни.')}</p>}
        </Card>
      )}
    </div>
  );
}

async function BasesBoard({ userId }: { userId: string }) {
  const { db, now } = await gameContext();
  const [rows, mine] = await Promise.all([topBases(db, now, 50), membershipOf(db, userId)]);
  return (
    <Card className="p-2 sm:p-3">
      <p className="px-2 pb-2 text-xs text-mist-400 sm:px-3">{tr('„Браво“ от други играчи за последните 30 дни (при равенство — повече сгради и нива). Разгледай базата от профила на компанията.')}</p>
      <ol className="divide-y divide-asphalt-800">
        {rows.map((r, i) => (
          <li key={r.id} className={`flex items-center gap-3 rounded-xl px-2 py-2.5 sm:px-3 ${r.id === mine?.company.id ? 'bg-volt-500/10 ring-1 ring-volt-500/30' : ''}`}>
            <span className="num w-8 shrink-0 text-center font-display font-bold text-mist-300">{medal(i)}</span>
            <div className="min-w-0 flex-1">
              <Link href={`/game/companies/${r.id}`} className="block truncate font-semibold hover:underline">{r.tag ? `[${r.tag}] ` : ''}{tx(r.name)}</Link>
              <div className="text-xs text-mist-400">{tr('ниво {0} · сгради и нива {1}', r.level, r.buildings)}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="num font-display font-bold text-gold-400">👍 {int(r.likes)}</div>
              <div className="text-[11px] text-mist-400">{tr('за 30 дни')}</div>
            </div>
          </li>
        ))}
      </ol>
      {rows.length === 0 && <p className="p-3 text-sm text-mist-400">{tr('Още никоя компания не е построила база.')}</p>}
    </Card>
  );
}

async function DivisionsBoard({ userId }: { userId: string }) {
  const { db, now } = await gameContext();
  const mine = (await membershipOf(db, userId))?.company.id;
  const tables = await Promise.all(DIVISIONS.slice().reverse().map(async (d) => ({ d, rows: await divisionTable(db, d, now) })));
  return (
    <div className="space-y-4">
      <p className="text-sm text-mist-300">{tr('Компаниите се състезават по тоновете на членовете си за месеца. В края на месеца най-добрите {0} % се качват, последните слизат, а първите трима получават награда в касата. Игрови данни.', Math.round(DIVISION_RULES.moveShare * 100))}</p>
      {tables.map(({ d, rows }) => (
        <Card key={d} title={tr('{0} {1} дивизия', d === 'gold' ? '🥇' : d === 'silver' ? '🥈' : '🥉', tx(DIVISION_LABELS[d]))} className="p-2 sm:p-3">
          {rows.length === 0 ? <p className="p-2 text-sm text-mist-400">{tr('Още няма компании.')}</p> : (
            <ol className="divide-y divide-asphalt-800">
              {rows.slice(0, 20).map((r) => (
                <li key={r.id} className={`flex items-center gap-3 rounded-xl px-2 py-2 ${r.id === mine ? 'bg-volt-500/10 ring-1 ring-volt-500/30' : ''}`}>
                  <span className="num w-8 text-center font-display font-bold text-mist-300">{medal(r.rank - 1)}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{tx(r.name)}{r.tag ? <span className="text-xs text-mist-400"> [{tx(r.tag)}]</span> : null}</span>
                  <span className="text-xs">{r.move === 'up' ? <span className="text-profit">⬆</span> : r.move === 'down' ? <span className="text-loss">⬇</span> : null}</span>
                  <span className="num font-display font-bold text-gold-400">{tr('{0} т', int(r.tons))}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="px-2 pt-1 text-xs text-mist-400">{tr('Награди:')}{' '}{DIVISION_RULES.prizes[d].map((p) => money(p)).join(' / ')}</p>
        </Card>
      ))}
    </div>
  );
}

async function EcoBoardView({ userId }: { userId: string }) {
  const { db, now } = await gameContext();
  const week = ecoWeek(now);
  const rows = await ecoBoard(db, week);
  const perKm = (r: { perKm: number }) => tr('{0} лв.', (r.perKm / 100).toFixed(2).replace('.', ','));
  return (
    <Card className="p-2 sm:p-3">
      <p className="px-2 pb-2 pt-1 text-sm text-mist-300 sm:px-3">
        {tr('Седмицата до {0}: най-ниски разходи на километър (гориво, пътни такси, поддръжка, пътна помощ) за собствени курсове — наетите камиони не се броят. Нужни са поне {1} км. Първите трима получават', week.to.toLocaleDateString(intlLocale(), { timeZone: 'Europe/Sofia', day: 'numeric', month: 'long' }), int(ECO.minKm))}{' '}{ECO.prizes.map((p) => `${money(p.cents)} + ${p.coins} TC`).join(' / ')}.
      </p>
      <ol className="divide-y divide-asphalt-800">
        {rows.map((r, i) => (
          <li key={r.userId} className={`flex items-center gap-3 rounded-xl px-2 py-2.5 sm:px-3 ${r.userId === userId ? 'bg-volt-500/10 ring-1 ring-volt-500/30' : ''}`}>
            <span className="num w-8 shrink-0 text-center font-display font-bold text-mist-300">{medal(i)}</span>
            <div className="min-w-0 flex-1">
              <PlayerName name={r.username} className="font-semibold" />
              <div className="text-xs text-mist-400">{tr('{0} км · разходи {1}', int(r.km), money(r.costCents))}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="num font-display font-bold text-gold-400">{perKm(r)}</div>
              <div className="text-[11px] text-mist-400">{tr('на км')}</div>
            </div>
          </li>
        ))}
      </ol>
      {rows.length === 0 && <p className="p-3 text-sm text-mist-400">{tr('Още никой не е изминал {0} км тази седмица.', int(ECO.minKm))}</p>}
    </Card>
  );
}

async function RecordsBoard() {
  const { db, now } = await gameContext();
  const rows = await laneRecordsView(db, now, 50);
  return (
    <Card className="p-2 sm:p-3">
      <p className="px-2 pb-2 text-sm text-mist-300">{tr('Най-бързият курс с товар по всяка линия този месец (от натоварването до пристигането, навреме, поне {0} км). Нов месец — нови рекорди. Игрови данни.', LANE_RECORDS.minKm)}</p>
      {rows.length ? (
        <ul className="divide-y divide-asphalt-800">
          {rows.map((r) => (
            <li key={`${r.originCityId}-${r.destCityId}`} className="flex items-center justify-between gap-3 px-2 py-2.5 text-sm">
              <span className="min-w-0"><span className="block truncate font-medium">{tx(r.from)} → {tx(r.to)}</span><span className="block text-xs text-mist-400">{tr('{0} км ·', int(Math.round(r.km)))}{' '}<PlayerName name={r.username} /></span></span>
              <span className="num shrink-0 font-semibold">{tr('{0} ч {1} мин', Math.floor(r.minutes / 60), r.minutes % 60)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="px-2 py-4 text-sm text-mist-400">{tr('Този месец още няма рекорди.')}</p>}
    </Card>
  );
}

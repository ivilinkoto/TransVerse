import Link from 'next/link';
import { topBases } from '@/server/game/plot';
import { Card, PageHeader, Segmented } from '@/components/ui';
import { hasUnlock } from '@/lib/game/company';
import { isVip } from '@/lib/game/vip';
import { PlayerName } from '@/components/game/PlayerName';
import { int, money } from '@/lib/format';
import { gameContext } from '@/server/game/context';
import { membershipOf } from '@/server/game/membership';
import { companyLeaderboard, leaderboard, type LeaderboardKind } from '@/server/game/queries';
import { ECO } from '@/lib/game/eco';
import { ecoBoard, ecoWeek } from '@/server/game/eco';
import { DIVISION_LABELS, DIVISION_RULES, DIVISIONS } from '@/lib/game/competition';
import { divisionTable } from '@/server/game/competition';
import { LANE_RECORDS } from '@/lib/game/community';
import { laneRecordsView } from '@/server/game/community';

export const metadata = { title: 'Класации' };

const TABS: { id: LeaderboardKind | 'eco' | 'bases' | 'divisions' | 'records'; label: string; unit: string }[] = [
  { id: 'season', label: 'Сезон', unit: 'точки' },
  { id: 'wealth', label: 'Богатство', unit: 'стойност' },
  { id: 'deliveries', label: 'Доставки', unit: 'доставки' },
  { id: 'companies', label: 'Компании', unit: 'опит' },
  { id: 'eco', label: 'Икономичен шофьор', unit: 'лв./км' },
  { id: 'bases', label: 'Най-красиви бази', unit: 'харесвания' },
  { id: 'divisions', label: 'Дивизии', unit: 'тонове' },
  { id: 'records', label: 'Рекорди на линии', unit: 'време' },
];

const medal = (i: number) => (i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1);

export default async function LeaderboardsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { db, user, company, features } = await gameContext();
  const tabs = TABS.filter((t) => (t.id !== 'eco' || features.eco) && (t.id !== 'bases' || features.plot_guests) && (t.id !== 'divisions' || features.divisions) && (t.id !== 'records' || features.lane_records));
  const requested = (await searchParams).tab;
  const tab = tabs.find((t) => t.id === requested) ?? tabs[0]!;
  return (
    <div className="space-y-5">
      <PageHeader title="Класации" subtitle="Само реални играчи и техните компании. Няма измислени конкуренти." />
      <Segmented label="Вид класация" active={tab.id} items={tabs.map((t) => ({ id: t.id, label: t.label, href: `/game/leaderboards?tab=${t.id}` }))} />
      {tab.id === 'records' ? <RecordsBoard /> : tab.id === 'divisions' ? <DivisionsBoard userId={user.id} /> : tab.id === 'bases' ? <BasesBoard userId={user.id} /> : tab.id === 'eco' ? <EcoBoardView userId={user.id} /> : tab.id === 'companies' ? <CompanyBoard userId={user.id} /> : <PlayerBoard kind={tab.id} unit={tab.unit} companyId={company.id} />}
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
              <div className="truncate font-semibold">{r.company}</div>
              <div className="flex items-center gap-2 text-xs text-mist-400"><PlayerName name={r.owner} role={r.ownerRole} vip={isVip(r.ownerVipUntil, now)} /><span>· ниво {r.level}</span></div>
            </div>
            <div className="shrink-0 text-right">
              <div className="num font-display font-bold text-gold-400">{kind === 'wealth' ? money(r.value) : int(r.value)}</div>
              <div className="text-[11px] text-mist-400">{unit}</div>
            </div>
          </li>
        ))}
      </ol>
      {rows.length === 0 && <p className="p-3 text-sm text-mist-400">Все още няма данни.</p>}
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
                {r.tag && hasUnlock(r.level, 'tag') && <span style={{ color: r.color ?? undefined }}>[{r.tag}] </span>}
                {r.company}
              </Link>
              <div className="flex flex-wrap items-center gap-x-2 text-xs text-mist-400"><PlayerName name={r.owner} role={r.ownerRole} vip={isVip(r.ownerVipUntil, now)} /><span>· ниво {r.level} · {int(r.members)} членове</span></div>
            </div>
            <div className="shrink-0 text-right">
              <div className="num font-display font-bold text-gold-400">{int(r.value)}</div>
              <div className="text-[11px] text-mist-400">опит</div>
            </div>
          </li>
        ))}
      </ol>
      {rows.length === 0 && <p className="p-3 text-sm text-mist-400">Все още няма основани компании.</p>}
    </Card>
  );
}

async function BasesBoard({ userId }: { userId: string }) {
  const { db, now } = await gameContext();
  const [rows, mine] = await Promise.all([topBases(db, now, 50), membershipOf(db, userId)]);
  return (
    <Card className="p-2 sm:p-3">
      <p className="px-2 pb-2 text-xs text-mist-400 sm:px-3">„Браво“ от други играчи за последните 30 дни (при равенство — повече сгради и нива). Разгледай базата от профила на компанията.</p>
      <ol className="divide-y divide-asphalt-800">
        {rows.map((r, i) => (
          <li key={r.id} className={`flex items-center gap-3 rounded-xl px-2 py-2.5 sm:px-3 ${r.id === mine?.company.id ? 'bg-volt-500/10 ring-1 ring-volt-500/30' : ''}`}>
            <span className="num w-8 shrink-0 text-center font-display font-bold text-mist-300">{medal(i)}</span>
            <div className="min-w-0 flex-1">
              <Link href={`/game/companies/${r.id}`} className="block truncate font-semibold hover:underline">{r.tag ? `[${r.tag}] ` : ''}{r.name}</Link>
              <div className="text-xs text-mist-400">ниво {r.level} · сгради и нива {r.buildings}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="num font-display font-bold text-gold-400">👍 {int(r.likes)}</div>
              <div className="text-[11px] text-mist-400">за 30 дни</div>
            </div>
          </li>
        ))}
      </ol>
      {rows.length === 0 && <p className="p-3 text-sm text-mist-400">Още никоя компания не е построила база.</p>}
    </Card>
  );
}

async function DivisionsBoard({ userId }: { userId: string }) {
  const { db, now } = await gameContext();
  const mine = (await membershipOf(db, userId))?.company.id;
  const tables = await Promise.all(DIVISIONS.slice().reverse().map(async (d) => ({ d, rows: await divisionTable(db, d, now) })));
  return (
    <div className="space-y-4">
      <p className="text-sm text-mist-300">Компаниите се състезават по тоновете на членовете си за месеца. В края на месеца най-добрите {Math.round(DIVISION_RULES.moveShare * 100)} % се качват, последните слизат, а първите трима получават награда в касата. Игрови данни.</p>
      {tables.map(({ d, rows }) => (
        <Card key={d} title={`${d === 'gold' ? '🥇' : d === 'silver' ? '🥈' : '🥉'} ${DIVISION_LABELS[d]} дивизия`} className="p-2 sm:p-3">
          {rows.length === 0 ? <p className="p-2 text-sm text-mist-400">Още няма компании.</p> : (
            <ol className="divide-y divide-asphalt-800">
              {rows.slice(0, 20).map((r) => (
                <li key={r.id} className={`flex items-center gap-3 rounded-xl px-2 py-2 ${r.id === mine ? 'bg-volt-500/10 ring-1 ring-volt-500/30' : ''}`}>
                  <span className="num w-8 text-center font-display font-bold text-mist-300">{medal(r.rank - 1)}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{r.name}{r.tag ? <span className="text-xs text-mist-400"> [{r.tag}]</span> : null}</span>
                  <span className="text-xs">{r.move === 'up' ? <span className="text-profit">⬆</span> : r.move === 'down' ? <span className="text-loss">⬇</span> : null}</span>
                  <span className="num font-display font-bold text-gold-400">{int(r.tons)} т</span>
                </li>
              ))}
            </ol>
          )}
          <p className="px-2 pt-1 text-xs text-mist-400">Награди: {DIVISION_RULES.prizes[d].map((p) => money(p)).join(' / ')}</p>
        </Card>
      ))}
    </div>
  );
}

async function EcoBoardView({ userId }: { userId: string }) {
  const { db, now } = await gameContext();
  const week = ecoWeek(now);
  const rows = await ecoBoard(db, week);
  const perKm = (r: { perKm: number }) => `${(r.perKm / 100).toFixed(2).replace('.', ',')} лв.`;
  return (
    <Card className="p-2 sm:p-3">
      <p className="px-2 pb-2 pt-1 text-sm text-mist-300 sm:px-3">
        Седмицата до {week.to.toLocaleDateString('bg-BG', { timeZone: 'Europe/Sofia', day: 'numeric', month: 'long' })}: най-ниски разходи на километър (гориво, пътни такси, поддръжка, пътна помощ) за собствени курсове — наетите камиони не се броят. Нужни са поне {int(ECO.minKm)} км. Първите трима получават {ECO.prizes.map((p) => `${money(p.cents)} + ${p.coins} TC`).join(' / ')}.
      </p>
      <ol className="divide-y divide-asphalt-800">
        {rows.map((r, i) => (
          <li key={r.userId} className={`flex items-center gap-3 rounded-xl px-2 py-2.5 sm:px-3 ${r.userId === userId ? 'bg-volt-500/10 ring-1 ring-volt-500/30' : ''}`}>
            <span className="num w-8 shrink-0 text-center font-display font-bold text-mist-300">{medal(i)}</span>
            <div className="min-w-0 flex-1">
              <PlayerName name={r.username} className="font-semibold" />
              <div className="text-xs text-mist-400">{int(r.km)} км · разходи {money(r.costCents)}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="num font-display font-bold text-gold-400">{perKm(r)}</div>
              <div className="text-[11px] text-mist-400">на км</div>
            </div>
          </li>
        ))}
      </ol>
      {rows.length === 0 && <p className="p-3 text-sm text-mist-400">Още никой не е изминал {int(ECO.minKm)} км тази седмица.</p>}
    </Card>
  );
}

async function RecordsBoard() {
  const { db, now } = await gameContext();
  const rows = await laneRecordsView(db, now, 50);
  return (
    <Card className="p-2 sm:p-3">
      <p className="px-2 pb-2 text-sm text-mist-300">Най-бързият курс с товар по всяка линия този месец (от натоварването до пристигането, навреме, поне {LANE_RECORDS.minKm} км). Нов месец — нови рекорди. Игрови данни.</p>
      {rows.length ? (
        <ul className="divide-y divide-asphalt-800">
          {rows.map((r) => (
            <li key={`${r.originCityId}-${r.destCityId}`} className="flex items-center justify-between gap-3 px-2 py-2.5 text-sm">
              <span className="min-w-0"><span className="block truncate font-medium">{r.from} → {r.to}</span><span className="block text-xs text-mist-400">{int(Math.round(r.km))} км · <PlayerName name={r.username} /></span></span>
              <span className="num shrink-0 font-semibold">{Math.floor(r.minutes / 60)} ч {r.minutes % 60} мин</span>
            </li>
          ))}
        </ul>
      ) : <p className="px-2 py-4 text-sm text-mist-400">Този месец още няма рекорди.</p>}
    </Card>
  );
}

import Link from 'next/link';
import { Card, PageHeader, Segmented } from '@/components/ui';
import { hasUnlock } from '@/lib/game/company';
import { isVip } from '@/lib/game/vip';
import { PlayerName } from '@/components/game/PlayerName';
import { int, money } from '@/lib/format';
import { gameContext } from '@/server/game/context';
import { membershipOf } from '@/server/game/membership';
import { companyLeaderboard, leaderboard, type LeaderboardKind } from '@/server/game/queries';

export const metadata = { title: 'Класации' };

const TABS: { id: LeaderboardKind; label: string; unit: string }[] = [
  { id: 'season', label: 'Сезон', unit: 'точки' },
  { id: 'wealth', label: 'Богатство', unit: 'стойност' },
  { id: 'deliveries', label: 'Доставки', unit: 'доставки' },
  { id: 'companies', label: 'Компании', unit: 'опит' },
];

const medal = (i: number) => (i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1);

export default async function LeaderboardsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { db, user, company } = await gameContext();
  const requested = (await searchParams).tab;
  const tab = TABS.find((t) => t.id === requested) ?? TABS[0]!;
  return (
    <div className="space-y-5">
      <PageHeader title="Класации" subtitle="Само реални играчи и техните компании. Няма измислени конкуренти." />
      <Segmented label="Вид класация" active={tab.id} items={TABS.map((t) => ({ id: t.id, label: t.label, href: `/game/leaderboards?tab=${t.id}` }))} />
      {tab.id === 'companies' ? <CompanyBoard userId={user.id} /> : <PlayerBoard kind={tab.id} unit={tab.unit} companyId={company.id} />}
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

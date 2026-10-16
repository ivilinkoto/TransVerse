import Link from 'next/link';
import { Card, PageHeader, Table } from '@/components/ui';
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
    <div className="space-y-6">
      <PageHeader title="Класации" subtitle="Само реални играчи и техните компании. Няма измислени конкуренти." />
      <nav className="flex flex-wrap gap-2" aria-label="Вид класация">
        {TABS.map((t) => (
          <Link key={t.id} href={`/game/leaderboards?tab=${t.id}`} className={t.id === tab.id ? 'btn-primary' : 'btn-ghost'}>{t.label}</Link>
        ))}
      </nav>
      {tab.id === 'companies' ? <CompanyBoard userId={user.id} /> : <PlayerBoard kind={tab.id} unit={tab.unit} companyId={company.id} />}
    </div>
  );
}

async function PlayerBoard({ kind, unit, companyId }: { kind: Exclude<LeaderboardKind, 'companies'>; unit: string; companyId: string }) {
  const { db, now } = await gameContext();
  const { rows } = await leaderboard(db, kind, 100);
  return (
    <Card>
      <Table head={['#', 'Компания', 'Играч', 'Ниво', unit]}>
        {rows.map((r, i) => (
          <tr key={r.companyId} className={r.companyId === companyId ? 'bg-volt-500/10' : ''}>
            <td className="num px-3 py-2 font-bold">{medal(i)}</td>
            <td className="px-3 py-2 font-semibold">{r.company}</td>
            <td className="px-3 py-2 text-mist-400"><PlayerName name={r.owner} role={r.ownerRole} vip={isVip(r.ownerVipUntil, now)} /></td>
            <td className="num px-3 py-2">{r.level}</td>
            <td className="num px-3 py-2 text-gold-400">{kind === 'wealth' ? money(r.value) : int(r.value)}</td>
          </tr>
        ))}
      </Table>
      {rows.length === 0 && <p className="mt-3 text-sm text-mist-400">Все още няма данни.</p>}
    </Card>
  );
}

async function CompanyBoard({ userId }: { userId: string }) {
  const { db, now } = await gameContext();
  const [rows, mine] = await Promise.all([companyLeaderboard(db, 100), membershipOf(db, userId)]);
  return (
    <Card>
      <Table head={['#', 'Компания', 'Собственик', 'Ниво', 'Членове', 'опит']}>
        {rows.map((r, i) => (
          <tr key={r.companyId} className={r.companyId === mine?.company.id ? 'bg-volt-500/10' : ''}>
            <td className="num px-3 py-2 font-bold">{medal(i)}</td>
            <td className="px-3 py-2 font-semibold">
              <Link href={`/game/companies/${r.companyId}`} className="hover:underline">
                {r.tag && hasUnlock(r.level, 'tag') && <span style={{ color: r.color ?? undefined }}>[{r.tag}] </span>}
                {r.company}
              </Link>
            </td>
            <td className="px-3 py-2 text-mist-400"><PlayerName name={r.owner} role={r.ownerRole} vip={isVip(r.ownerVipUntil, now)} /></td>
            <td className="num px-3 py-2">{r.level}</td>
            <td className="num px-3 py-2">{int(r.members)}</td>
            <td className="num px-3 py-2 text-gold-400">{int(r.value)}</td>
          </tr>
        ))}
      </Table>
      {rows.length === 0 && <p className="mt-3 text-sm text-mist-400">Все още няма основани компании.</p>}
    </Card>
  );
}

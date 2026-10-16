import Link from 'next/link';
import { Card, PageHeader, Table } from '@/components/ui';
import { int, money } from '@/lib/format';
import { gameContext } from '@/server/game/context';
import { leaderboard, type LeaderboardKind } from '@/server/game/queries';

export const metadata = { title: 'Класации' };

const TABS: { id: LeaderboardKind; label: string; unit: string }[] = [
  { id: 'season', label: 'Сезон', unit: 'точки' },
  { id: 'wealth', label: 'Богатство', unit: 'стойност' },
  { id: 'deliveries', label: 'Доставки', unit: 'доставки' },
];

export default async function LeaderboardsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { db, company } = await gameContext();
  const requested = (await searchParams).tab;
  const tab = TABS.find((t) => t.id === requested) ?? TABS[0]!;
  const { rows } = await leaderboard(db, tab.id, 100);
  return (
    <div className="space-y-6">
      <PageHeader title="Класации" subtitle="Само реални компании на играчи. Няма измислени конкуренти." />
      <nav className="flex gap-2" aria-label="Вид класация">
        {TABS.map((t) => (
          <Link key={t.id} href={`/game/leaderboards?tab=${t.id}`} className={t.id === tab.id ? 'btn-primary' : 'btn-ghost'}>{t.label}</Link>
        ))}
      </nav>
      <Card>
        <Table head={['#', 'Компания', 'Играч', 'Ниво', tab.unit]}>
          {rows.map((r, i) => (
            <tr key={r.companyId} className={r.companyId === company.id ? 'bg-volt-500/10' : ''}>
              <td className="num px-3 py-2 font-bold">{i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</td>
              <td className="px-3 py-2 font-semibold">{r.company}</td>
              <td className="px-3 py-2 text-mist-400">{r.owner}</td>
              <td className="num px-3 py-2">{r.level}</td>
              <td className="num px-3 py-2 text-gold-400">{tab.id === 'wealth' ? money(r.value) : int(r.value)}</td>
            </tr>
          ))}
        </Table>
        {rows.length === 0 && <p className="mt-3 text-sm text-mist-400">Все още няма данни.</p>}
      </Card>
    </div>
  );
}

import { Medal, Trophy } from 'lucide-react';
import Link from 'next/link';
import { Card } from '@/components/ui';
import { int, money } from '@/lib/format';
import type { DbOrTx } from '@/server/db/client';
import { activeSeason, organizationSeasonResults, organizationSeasonTable } from '@/server/game/seasons';

const MEDAL = ['text-gold-400', 'text-mist-300', 'text-amber-sig'];

/** The company's place in the running season and badges from past seasons. */
export async function CompanySeason({ db, organizationId }: { db: DbOrTx; organizationId: string }) {
  const season = await activeSeason(db);
  const [table, results] = await Promise.all([organizationSeasonTable(db, season.id, 500), organizationSeasonResults(db, organizationId)]);
  const index = table.findIndex((r) => r.organizationId === organizationId);
  const podium = results.filter((r) => (r.rank ?? 99) <= 10);
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Trophy className="h-4 w-4 text-gold-400" />Сезон</span>} actions={<Link href="/game/seasons?tab=companies" className="text-sm text-cyan-glow hover:underline">Класация →</Link>}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="label">{season.name}</div>
          <div className="num mt-1 font-display text-2xl font-bold text-gold-400">{index >= 0 ? `#${index + 1}` : '—'}</div>
        </div>
        <div className="text-right text-sm text-mist-400">{index >= 0 ? <><span className="num font-semibold text-white">{int(table[index]!.points)}</span> точки · {int(table[index]!.deliveries)} доставки</> : 'Първата доставка на член ви вкарва в класацията.'}</div>
      </div>
      {podium.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Минали сезони">
          {podium.map((r) => (
            <li key={r.seasonId} title={`${r.name}: ${r.rank}. място${r.prizeCents ? `, ${money(r.prizeCents)}` : ''}`} className="inline-flex items-center gap-1.5 rounded-full border border-asphalt-700 bg-asphalt-850 px-2.5 py-1 text-xs">
              <Medal className={`h-3.5 w-3.5 ${MEDAL[(r.rank ?? 4) - 1] ?? 'text-cyan-glow'}`} />
              <span className="font-semibold">#{r.rank}</span>
              <span className="text-mist-400">{r.name.replace(/^Сезон /, '')}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

import { and, desc, eq } from 'drizzle-orm';
import { CalendarClock, Trophy } from 'lucide-react';
import { Card, Meter, PageHeader, Stat, Table } from '@/components/ui';
import { date, int, money } from '@/lib/format';
import { seasonScores, seasons } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { leaderboard } from '@/server/game/queries';
import type { SeasonRules } from '@/server/game/seasons';

export const metadata = { title: 'Сезони' };

export default async function SeasonsPage() {
  const { db, company, now } = await gameContext();
  const { season, rows } = await leaderboard(db, 'season', 200);
  const rules = season!.rules as SeasonRules;
  const myIndex = rows.findIndex((r) => r.companyId === company.id);
  const total = season!.endsAt.getTime() - season!.startsAt.getTime();
  const elapsed = Math.min(1, (now.getTime() - season!.startsAt.getTime()) / total);
  const daysLeft = Math.max(0, Math.ceil((season!.endsAt.getTime() - now.getTime()) / 86_400_000));
  const past = await db.select().from(seasons).where(eq(seasons.status, 'finished')).orderBy(desc(seasons.id)).limit(6);
  const myPast = past.length ? await db.select().from(seasonScores).where(and(eq(seasonScores.companyId, company.id))) : [];

  return (
    <div className="space-y-6">
      <PageHeader title={season!.name} subtitle="Сезонните точки идват от доставки (километри × тонаж, повече за навреме). В края на сезона първите места получават награди. Компанията, парите и техниката остават." />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Остават" value={`${daysLeft} дни`} icon={CalendarClock} tone="cyan" hint={`${date(season!.startsAt)} – ${date(season!.endsAt)}`} />
        <Stat label="Вашето място" value={myIndex >= 0 ? `#${myIndex + 1}` : '—'} icon={Trophy} tone="gold" hint={myIndex >= 0 ? `${int(rows[myIndex]!.value)} точки` : 'Направете доставка, за да влезете в класацията'} />
        <Stat label="Награден фонд" value={money(rules.prizesCents.reduce((a, b) => a + b, 0))} tone="prestige" hint={`за първите ${rules.prizesCents.length} места`} />
      </div>
      <Card><div className="flex justify-between text-xs text-mist-400"><span>Ход на сезона</span><span className="num">{Math.round(elapsed * 100)}%</span></div><Meter value={elapsed * 100} tone="cyan" className="mt-2" /></Card>
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card title="Сезонна класация">
          <Table head={['#', 'Компания', 'Играч', 'Ниво', 'Доставки', 'Точки']}>
            {rows.slice(0, 50).map((r, i) => (
              <tr key={r.companyId} className={r.companyId === company.id ? 'bg-volt-500/10' : ''}>
                <td className="num px-3 py-2 font-bold">{i + 1}</td>
                <td className="px-3 py-2 font-semibold">{r.company}</td>
                <td className="px-3 py-2 text-mist-400">{r.owner}</td>
                <td className="num px-3 py-2">{r.level}</td>
                <td className="num px-3 py-2">{r.deliveries}</td>
                <td className="num px-3 py-2 text-gold-400">{int(r.value)}</td>
              </tr>
            ))}
          </Table>
          {rows.length === 0 && <p className="mt-3 text-sm text-mist-400">Никой още не е натрупал точки този сезон.</p>}
        </Card>
        <div className="space-y-6">
          <Card title="Награди">
            <ol className="space-y-2 text-sm">
              {rules.prizesCents.map((p, i) => <li key={i} className="flex justify-between rounded-lg bg-asphalt-850 px-3 py-2"><span>{i + 1}. място</span><span className="num text-gold-400">{money(p)}</span></li>)}
            </ol>
          </Card>
          <Card title="Минали сезони">
            {past.length === 0 ? <p className="text-sm text-mist-400">Това е първият сезон.</p> : (
              <ul className="space-y-2 text-sm">
                {past.map((s) => {
                  const mine = myPast.find((m) => m.seasonId === s.id);
                  return <li key={s.id} className="flex justify-between rounded-lg bg-asphalt-850 px-3 py-2"><span>{s.name}</span><span className="text-mist-400">{mine?.finalRank ? `#${mine.finalRank} · ${int(mine.points)} т.` : 'не участвахте'}</span></li>;
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

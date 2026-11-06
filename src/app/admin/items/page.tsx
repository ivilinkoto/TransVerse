import { Card, PageHeader, Table } from '@/components/ui';
import { ItemArt } from '@/components/game/ItemArt';
import { dateTime, dec, int } from '@/lib/format';
import { CASE_TABLES, ITEMS, caseOdds, type CaseId, type ItemId } from '@/lib/game/items';
import { adminContext } from '@/server/admin-context';
import { itemStats } from '@/server/admin-items';
import { t as tr, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Предмети и кейсове') };
}

const SOURCE_LABELS: Record<string, string> = { daily: 'Дневна награда', level: 'Ново ниво', mystery: 'Тайна проверка', lost_cargo: 'Изгубен товар', challenge: 'Предизвикателство', big_run: 'Голям рейс', road_find: 'Находка по пътя', admin: 'Екипът', promo: 'Промокод', invite: 'Покана' };
const sourceLabel = (r: string) => (r.startsWith('case:') ? tr('От {0}', tx(ITEMS[r.slice(5) as ItemId]?.name ?? r)) : tx(SOURCE_LABELS[r] ?? r));

/** 1.2.1: cases opened, what came out against the promised odds, and where items come from. */
export default async function AdminItemsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await initLocale();
  const { db, now } = await adminContext({ admin: true });
  const days = [1, 7, 30].includes(Number((await searchParams).days)) ? Number((await searchParams).days) : 7;
  const s = await itemStats(db, days, now);
  return (
    <div className="space-y-6">
      <PageHeader title={tr('Предмети и кейсове')} subtitle={tr('Колко кейса са отворени, какво е паднало спрямо обещаните шансове и откъде идват предметите.')} />
      <div className="flex gap-2 text-sm">
        {[1, 7, 30].map((d) => <a key={d} href={`/admin/items?days=${d}`} className={d === days ? 'btn-primary px-3 py-1' : 'btn-ghost px-3 py-1'}>{d === 1 ? tr('24 часа') : tr('{0} дни', d)}</a>)}
        <span className="self-center text-xs text-mist-400">{tr('от {0}', dateTime(s.since))}</span>
      </div>
      {(Object.keys(CASE_TABLES) as CaseId[]).map((caseId) => {
        const opened = s.opened.find((o) => o.caseId === caseId)?.n ?? 0;
        const drops = s.drops.filter((d) => d.caseId === caseId);
        return (
          <Card key={caseId} title={<span className="inline-flex items-center gap-2"><ItemArt id={caseId} className="h-6 w-6" />{tr('{0} — отворени {1}', tx(ITEMS[caseId].name), int(opened))}</span>}>
            <Table head={[tr('Предмет'), tr('Обещан шанс'), tr('Паднали'), tr('Реален дял')]}>
              {caseOdds(caseId).map((o) => {
                const n = drops.find((d) => d.itemId === o.item)?.n ?? 0;
                const real = opened ? (n / opened) * 100 : 0;
                const off = opened >= 50 && Math.abs(real - o.percent) > Math.max(3, o.percent * 0.5);
                return (
                  <tr key={o.item}>
                    <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5"><ItemArt id={o.item} className="h-5 w-5" />{tx(ITEMS[o.item].name)}</span></td>
                    <td className="num px-3 py-2 text-mist-400">{dec(o.percent)}%</td>
                    <td className="num px-3 py-2">{int(n)}</td>
                    <td className={`num px-3 py-2 ${off ? 'font-semibold text-amber-sig' : ''}`}>{opened ? `${dec(real)}%` : '—'}</td>
                  </tr>
                );
              })}
            </Table>
            {opened < 50 && <p className="mt-2 text-xs text-mist-400">{tr('Под 50 отворени кейса реалният дял още може да се разминава с шанса.')}</p>}
          </Card>
        );
      })}
      <Card title={tr('Откъде идват предметите')}>
        {!s.sources.length ? <p className="text-sm text-mist-400">{tr('Няма за периода.')}</p> : (
          <ul className="space-y-1 text-sm">
            {s.sources.map((x) => <li key={x.reason} className="flex justify-between gap-2"><span>{sourceLabel(x.reason)}</span><span className="num">{int(x.n)}</span></li>)}
          </ul>
        )}
      </Card>
    </div>
  );
}

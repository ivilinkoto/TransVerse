import { Card, PageHeader, Table } from '@/components/ui';
import { int } from '@/lib/format';
import { adminContext } from '@/server/admin-context';
import { pageStats } from '@/server/page-views';
import { t as tr, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Посещения на страниците') };
}

/**
 * 1.2.1.1: which game pages players really open — the data for simplifying the
 * menus. Staff visits are not counted; ids in the path are folded into [id].
 */
export default async function AdminPagesPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await initLocale();
  const { db, now } = await adminContext();
  const days = [1, 7, 30].includes(Number((await searchParams).days)) ? Number((await searchParams).days) : 7;
  const s = await pageStats(db, days, now);
  const share = (n: number) => (s.total ? Math.round((n / s.total) * 100) : 0);
  return (
    <div className="space-y-6">
      <PageHeader title={tr('Посещения на страниците')} subtitle={tr('Кои страници на играта отварят играчите (без екипа). Основа за опростяването на менюто.')} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {[1, 7, 30].map((d) => <a key={d} href={`/admin/pages?days=${d}`} className={d === days ? 'btn-primary px-3 py-1' : 'btn-ghost px-3 py-1'}>{d === 1 ? tr('Днес') : tr('{0} дни', d)}</a>)}
        <span className="text-xs text-mist-400">{tr('Активни играчи за периода: {0}', int(s.total))}</span>
      </div>
      <Card title={tr('Страници по брой играчи ({0})', s.rows.length)}>
        <Table head={[tr('Страница'), tr('Раздел'), tr('Играчи'), tr('Дял'), tr('Отваряния')]}>
          {s.rows.map((r) => (
            <tr key={r.path} className={share(r.players) < 2 ? 'text-mist-400' : ''}>
              <td className="py-1.5"><span className="font-medium">{r.label ? tx(r.label) : r.path}</span>{r.label && <span className="ml-2 text-xs text-mist-500">{r.path}</span>}</td>
              <td>{r.section ? tx(r.section) : '—'}</td>
              <td className="num">{int(r.players)}</td>
              <td className="num">{share(r.players)}%</td>
              <td className="num">{int(r.views)}</td>
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-xs text-mist-400">{tr('В сиво — страници, отворени от под 2% от активните играчи.')}</p>
      </Card>
      <Card title={tr('В менюто, но никой не ги е отворил ({0})', s.unopened.length)}>
        {s.unopened.length ? (
          <ul className="grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {s.unopened.map((p) => <li key={p.path}>{tx(p.label)} <span className="text-xs text-mist-500">· {tx(p.section)} · {p.path}</span></li>)}
          </ul>
        ) : (
          <p className="text-sm text-mist-400">{tr('Всички страници от менюто са отворени поне веднъж.')}</p>
        )}
      </Card>
    </div>
  );
}

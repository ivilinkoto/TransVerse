import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui';
import { int } from '@/lib/format';
import { adminContext } from '@/server/admin-context';
import { releaseAdoption } from '@/server/admin-adoption';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Как се играе 1.3') };
}
export const dynamic = 'force-dynamic';

const pct = (part: number, of: number) => (of ? `${Math.round((part / of) * 100)}%` : '—');

/** After 1.3: how many players have tried each new system (read-only, players only). */
export default async function AdminAdoption() {
  await initLocale();
  const { db, now } = await adminContext({ admin: true });
  const a = await releaseAdoption(db, now);
  const peak = Math.max(1, ...a.rows.map((r) => r.players));
  return (
    <div className="space-y-6">
      <PageHeader title={t('Как се играе 1.3')} subtitle={t('Колко играчи са опитали всяка нова система. Само играчи, без екипа; нищо ново не се записва.')} />
      <Card title={t('Нови системи')}>
        <p className="mb-3 text-xs text-mist-400">{t('Активни играчи през последните 7 дни: {0}. Процентът е спрямо тях.', int(a.active7))}</p>
        <ul className="space-y-2" data-testid="adoption-rows">
          {a.rows.map((r) => (
            <li key={r.id} className="text-sm">
              <div className="flex justify-between gap-3">
                <span>{tx(r.label)}</span>
                <span className="num text-mist-300">{int(r.players)} · {pct(r.players, a.active7)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded bg-asphalt-800">
                <div className="h-1.5 rounded bg-cyan-glow/70" style={{ width: `${(r.players / peak) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-mist-400">{t('Автобусни линии общо: {0}.', int(a.busLines))}</p>
      </Card>
      <div className="grid gap-6 md:grid-cols-2">
        {([[t('Нощен рейс по дни'), a.nightRun], [t('Пътят на деня по дни'), a.dailyRoute]] as const).map(([title, days]) => (
          <Card key={title} title={title}>
            {days.length ? (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-asphalt-800">
                  {days.map((d) => (
                    <tr key={d.day}><td className="py-1.5">{d.day}</td><td className="num text-right">{int(d.players)}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-mist-400">{t('Още няма данни.')}</p>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

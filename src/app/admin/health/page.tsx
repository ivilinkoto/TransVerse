import type { Metadata } from 'next';
import { Badge, Card, PageHeader, Stat } from '@/components/ui';
import { money } from '@/lib/format';
import { adminContext } from '@/server/admin-context';
import { gameHealth } from '@/server/game/game-health';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Здраве на играта') };
}
export const dynamic = 'force-dynamic';

/** 1.2.3: is the game running well right now — players, trips, loads and idle trucks per country. */
export default async function AdminHealth() {
  await initLocale();
  const { db, now } = await adminContext();
  const h = await gameHealth(db, now);
  return (
    <div className="space-y-6">
      <PageHeader title={t('Здраве на играта')} subtitle={t('Какво става в играта в момента. Държава с празни камиони и без товари над 1 ч отива в #сигнали.')} />
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label={t('Играчи за 24 ч')} value={h.activePlayers} />
        <Stat label={t('Курсове за 24 ч')} value={h.trips} />
        <Stat label={t('Изплатено за 24 ч')} value={money(h.tripCents)} />
        <Stat label={t('Държави без товари')} value={h.starved.length} />
      </div>
      <Card title={t('По държави')}>
        {h.countries.length === 0 ? <p className="text-sm text-mist-400">{t('Няма свободни камиони и товари.')}</p> : (
          <table className="w-full text-sm" data-testid="health-countries">
            <thead><tr className="text-left text-xs text-mist-400"><th className="py-1.5">{t('Държава')}</th><th className="text-right">{t('Отворени товари')}</th><th className="text-right">{t('Свободни камиони')}</th><th className="text-right">{t('Състояние')}</th></tr></thead>
            <tbody className="divide-y divide-asphalt-800">
              {h.countries.map((c) => (
                <tr key={c.code}>
                  <td className="py-1.5">{tx(c.name)} <span className="text-xs text-mist-400">{c.code}</span></td>
                  <td className="num text-right">{c.openLoads}</td>
                  <td className="num text-right">{c.idleTrucks}</td>
                  <td className="text-right">{c.starved ? <Badge tone="red">{t('няма товари')}</Badge> : c.idleTrucks > c.openLoads * 3 ? <Badge tone="orange">{t('малко товари')}</Badge> : <Badge tone="green">{t('добре')}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

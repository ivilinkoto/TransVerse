import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { MapPin } from 'lucide-react';
import { Card, Empty, PageHeader } from '@/components/ui';
import { int, money } from '@/lib/format';
import { gameContext } from '@/server/game/context';
import { earningsByCity } from '@/server/game/earnings-map';
import { EarningsClient } from './EarningsClient';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Къде печеля') };
}

/** 1.1.4.2 „Къде печеля“: the net result of 30 days by destination city. */
export default async function EarningsPage() {
  await initLocale();
  const { db, company, hq, now, features } = await gameContext();
  if (!features.earnings_map) notFound();
  const rows = await earningsByCity(db, company.id, now);
  return (
    <div className="space-y-6">
      <PageHeader title={t('Къде печеля')} subtitle={t('Нетният резултат от курсовете за 30 дни по град на доставката. По-голям кръг — повече пари.')} />
      {!rows.length ? <Empty icon={MapPin} title={t('Още няма доставки за 30 дни')} /> : (
        <>
          <EarningsClient styleUrl={process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/dark'} center={[hq.lat, hq.lon]} points={rows.map((r) => ({ name: tx(r.name), lat: r.lat, lon: r.lon, cents: r.cents, trips: r.trips }))} />
          <Card title={t('Най-доходните градове')}>
            <ol className="space-y-1 text-sm">
              {rows.slice(0, 10).map((r, i) => (
                <li key={r.cityId} className="flex justify-between gap-2"><span>{i + 1}. {tx(r.name)} · {t('{0} курса', int(r.trips))}</span><span className={`num ${r.cents >= 0 ? 'text-profit' : 'text-loss'}`}>{money(r.cents)}</span></li>
              ))}
            </ol>
          </Card>
        </>
      )}
    </div>
  );
}

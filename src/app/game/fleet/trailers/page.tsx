import type { Metadata } from 'next';
import { Link2 } from 'lucide-react';
import { Empty, PageHeader } from '@/components/ui';
import { EmptyAction } from '@/components/game/EmptyAction';
import { TrailersPanel, truckPanelContext } from '@/components/game/TruckPanels';
import { gameContext } from '@/server/game/context';
import { fleetView } from '@/server/game/queries';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Ремаркета') };
}

/** 1.3.3 (Автопарк → Ремаркета): every trailer — where it is, sell or list it, its upgrades. Coupling is in each truck's window. */
export default async function TrailersPage() {
  await initLocale();
  const { db, user, company, now, features } = await gameContext();
  const [fleet, ctx] = await Promise.all([fleetView(db, company.id), truckPanelContext(db, user, company, now, features)]);
  const mine = fleet.trailers.filter((x) => x.ownership !== 'rented');
  return (
    <div className="space-y-4">
      <PageHeader title={t('Ремаркета')} subtitle={t('Къде е всяко ремарке, продажба и подобрения. Прикачваш ремарке от прозореца на камиона.')} />
      {mine.length ? <TrailersPanel fleet={fleet} ctx={ctx} /> : <Empty icon={Link2} title={t('Нямаш ремаркета')}><EmptyAction href="/game/market?show=trailers" label="Купи ремарке" /></Empty>}
    </div>
  );
}

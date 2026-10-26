import { Tag } from 'lucide-react';
import { notFound } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';
import { FitPlateForm, PlateBidForm } from '@/components/game/HireForms';
import { ActionButton } from '@/components/ui/ActionButton';
import { testsUnreleased } from '@/server/auth/roles';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { powerUnitModel } from '@/lib/game/catalog';
import { PLATE_AUCTION } from '@/lib/game/plates';
import { vehicles } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { plateAuctionView } from '@/server/game/plates';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Редки номера') };
}

/** v1.6: one rare plate a week under the hammer for ТрансКоин. */
export default async function PlatesPage() {
  await initLocale();
  const { db, user, company, now, features } = await gameContext();
  if (!features.plate_auction) notFound();
  const { auction, won } = await plateAuctionView(db, user.id, now);
  const own = won.length ? await db.select({ id: vehicles.id, plate: vehicles.plate, modelId: vehicles.modelId }).from(vehicles).where(and(eq(vehicles.companyId, company.id), eq(vehicles.ownership, 'owned'), isNull(vehicles.soldAt))) : [];
  const trucks = own.map((v) => ({ id: v.id, label: `${v.plate} · ${powerUnitModel(v.modelId).name}` }));
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('Редки номера')}
        subtitle={t('Всяка седмица един кратък номер, който не се продава в магазина, отива на търг за ТрансКоин.')}
        help={t('Офертата се задържа веднага; когато някой те надмине, ТрансКоин се връщат. Търгът започва от {0} TC, всяка нова оферта е с поне 10 % повече. Спечеленият номер слагаш на свой камион, когато решиш.', PLATE_AUCTION.startCoins)}
      />
      {auction ? (
        <Card title={<span className="inline-flex items-center gap-2"><Tag className="h-4 w-4 text-amber-sig" />{t('Номер на седмицата')}</span>}>
          <div className="flex flex-wrap items-center gap-6">
            <div className="rounded-lg border-2 border-mist-200 bg-white px-6 py-3 font-mono text-4xl font-bold tracking-widest text-asphalt-950">{tx(auction.plate)}</div>
            <div className="space-y-1 text-sm">
              <p>{auction.bidCoins ? <>{t('Водеща оферта:')}{' '}<span className="font-semibold">{tx(auction.bidCoins)} TC</span> · {tx(auction.leader)}{auction.mine ? <span className="ml-2"><Badge tone="green">{t('ти водиш')}</Badge></span> : null}</> : t('Още няма оферти.')}</p>
              <p className="text-mist-400">{t('Оферти: {0} · край {1}', auction.bids, dateTime(auction.endsAt))}</p>
            </div>
          </div>
          {!auction.mine && auction.endsAt > now && <div className="mt-4"><PlateBidForm minBid={auction.minBid} balance={user.coins} weekKey={auction.weekKey} /></div>}
          {testsUnreleased(user) && <div className="mt-4 border-t border-white/5 pt-3"><ActionButton endpoint="/api/admin/action" action={{ type: 'cancelPlateAuction', weekKey: auction.weekKey }} className="btn-danger px-3 py-1.5 text-xs" confirm={t('Да спрем ли търга? Водещата оферта се връща.')}>{t('Екип: спри търга')}</ActionButton></div>}
        </Card>
      ) : (
        <Card><Empty icon={Tag} title={t('Търгът се подготвя')}>{t('Номерът на седмицата се обявява до четвърт час след началото ѝ.')}</Empty></Card>
      )}
      {won.map((w) => (
        <Card key={w.weekKey} title={t('Спечелен номер „{0}“', w.plate)}>
          <FitPlateForm weekKey={w.weekKey} trucks={trucks} />
        </Card>
      ))}
    </div>
  );
}

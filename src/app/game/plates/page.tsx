import { Tag } from 'lucide-react';
import { notFound } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';
import { FitPlateForm, PlateBidForm } from '@/components/game/HireForms';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { powerUnitModel } from '@/lib/game/catalog';
import { PLATE_AUCTION } from '@/lib/game/plates';
import { vehicles } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { plateAuctionView } from '@/server/game/plates';

export const metadata = { title: 'Редки номера' };

/** v1.6: one rare plate a week under the hammer for ТрансКоин. */
export default async function PlatesPage() {
  const { db, user, company, now, features } = await gameContext();
  if (!features.plate_auction) notFound();
  const { auction, won } = await plateAuctionView(db, user.id, now);
  const own = won.length ? await db.select({ id: vehicles.id, plate: vehicles.plate, modelId: vehicles.modelId }).from(vehicles).where(and(eq(vehicles.companyId, company.id), eq(vehicles.ownership, 'owned'), isNull(vehicles.soldAt))) : [];
  const trucks = own.map((v) => ({ id: v.id, label: `${v.plate} · ${powerUnitModel(v.modelId).name}` }));
  return (
    <div className="space-y-6">
      <PageHeader
        title="Редки номера"
        subtitle="Всяка седмица един кратък номер, който не се продава в магазина, отива на търг за ТрансКоин."
        help={`Офертата се задържа веднага; когато някой те надмине, ТрансКоин се връщат. Търгът започва от ${PLATE_AUCTION.startCoins} TC, всяка нова оферта е с поне 10 % повече. Спечеленият номер слагаш на свой камион, когато решиш.`}
      />
      {auction ? (
        <Card title={<span className="inline-flex items-center gap-2"><Tag className="h-4 w-4 text-amber-sig" />Номер на седмицата</span>}>
          <div className="flex flex-wrap items-center gap-6">
            <div className="rounded-lg border-2 border-mist-200 bg-white px-6 py-3 font-mono text-4xl font-bold tracking-widest text-asphalt-950">{auction.plate}</div>
            <div className="space-y-1 text-sm">
              <p>{auction.bidCoins ? <>Водеща оферта: <span className="font-semibold">{auction.bidCoins} TC</span> · {auction.leader}{auction.mine ? <span className="ml-2"><Badge tone="green">ти водиш</Badge></span> : null}</> : 'Още няма оферти.'}</p>
              <p className="text-mist-400">Оферти: {auction.bids} · край {dateTime(auction.endsAt)}</p>
            </div>
          </div>
          {!auction.mine && auction.endsAt > now && <div className="mt-4"><PlateBidForm minBid={auction.minBid} balance={user.coins} /></div>}
        </Card>
      ) : (
        <Card><Empty icon={Tag} title="Търгът се подготвя">Номерът на седмицата се обявява до четвърт час след началото ѝ.</Empty></Card>
      )}
      {won.map((w) => (
        <Card key={w.weekKey} title={`Спечелен номер „${w.plate}“`}>
          <FitPlateForm weekKey={w.weekKey} trucks={trucks} />
        </Card>
      ))}
    </div>
  );
}

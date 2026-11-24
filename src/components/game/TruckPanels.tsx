/**
 * 1.3.3 „Всичко за камиона на едно място“: what the Service page showed for one
 * truck — repair, service, insurance, the trailer, the depot, upgrades and the
 * sale — as panels the truck window in Автопарк shows (and the Service page
 * reuses). Server components: they render the same actions as before.
 */
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { ShieldCheck, Wrench } from 'lucide-react';
import { Badge, Meter } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { SelectAction } from '@/components/ui/SelectAction';
import { ListForSale } from '@/components/game/ListForSale';
import { RepairPanel } from '@/components/game/RepairPanel';
import { TrailerIllustration } from '@/components/vehicles/VehicleIllustration';
import { TruckNameForm } from '@/components/game/TruckNameForm';
import { dateTime, int, money } from '@/lib/format';
import { TRAILERS, TRAILER_UPGRADES, UPGRADES, canCouple } from '@/lib/game/catalog';
import { repairCostCents } from '@/lib/game/economy';
import { insurancePriceCents, isInsured } from '@/lib/game/fines';
import { SCRAP } from '@/lib/game/heritage';
import { maintenanceCostCents, maintenanceState } from '@/lib/game/maintenance';
import { springDiscount } from '@/lib/game/marta';
import { USED_MARKET } from '@/lib/game/used-market';
import { isVip, VIP_PERKS } from '@/lib/game/vip';
import { vipLevel } from '@/lib/game/vip-levels';
import type { DbOrTx } from '@/server/db/client';
import { cities, depots } from '@/server/db/schema';
import { sparePartsOf } from '@/server/game/heritage';
import { bonusesForUser } from '@/server/game/membership';
import { winterTyreDiscount } from '@/server/game/prewinter';
import type { fleetView } from '@/server/game/queries';
import { boundsFor, myListings } from '@/server/game/used-market';
import { t as tr, tx } from '@/i18n/t';

type Fleet = Awaited<ReturnType<typeof fleetView>>;
type Vehicle = Fleet['vehicles'][number];
type Features = Record<string, boolean | undefined>;

/** What every truck's panels share: the discounts, the listings, the depots and the spare parts. */
export async function truckPanelContext(db: DbOrTx, user: { id: string; vipUntil: Date | null; vipLevel: number | null }, company: { id: string; balanceCents: number }, now: Date, features: Features) {
  const discount = (isVip(user.vipUntil, now) ? 1 - VIP_PERKS.garageDiscount : 1) * (1 - vipLevel(user.vipLevel).garage);
  const serviceDiscount = 1 - (1 - ((await bonusesForUser(db, user.id))?.bonuses.repairDiscount ?? 0)) * (1 - (features.marta ? springDiscount(now) : 0));
  const [listings, myDepots, spareParts] = await Promise.all([
    myListings(db, company.id),
    db.select({ id: depots.id, cityId: depots.cityId, name: cities.nameBg }).from(depots).innerJoin(cities, eq(cities.id, depots.cityId)).where(eq(depots.companyId, company.id)),
    features.scrapyard ? sparePartsOf(db, user.id) : Promise.resolve(0),
  ]);
  return { discount, serviceDiscount, listings, myDepots, spareParts, balanceCents: company.balanceCents, now, features };
}
export type TruckPanelContext = Awaited<ReturnType<typeof truckPanelContext>>;

const listingOf = (ctx: TruckPanelContext, id: string) => ctx.listings.find((l) => l.vehicleId === id || l.trailerId === id);

/** Repair, service, insurance, the trailer, the depot, the name and the scrapyard. */
export function TruckServicePanel({ v, fleet, ctx }: { v: Vehicle; fleet: Fleet; ctx: TruckPanelContext }) {
  const { discount, serviceDiscount, features, now } = ctx;
  const listing = listingOf(ctx, v.id);
  const busy = !!v.delivery || !!listing;
  const repair = Math.round((repairCostCents(v.model.priceCents, v.condition) + (v.trailer ? repairCostCents(v.trailer.model.priceCents, v.trailer.condition) : 0)) * discount * (1 - serviceDiscount));
  const upkeep = maintenanceState(v.odometerKm, v.serviceKm);
  const vipSave = features.vip_value && discount === 1 && repair > 0 ? Math.round(repair * VIP_PERKS.garageDiscount) : 0;
  const repairPanel = features.partial_repair ? <RepairPanel vehicleId={v.id} truck={{ priceCents: v.model.priceCents, condition: v.condition }} trailer={v.trailer ? { priceCents: v.trailer.model.priceCents, condition: v.trailer.condition } : null} factor={discount * (1 - serviceDiscount)} balanceCents={ctx.balanceCents} disabled={busy} /> : null;
  const upkeepCost = maintenanceCostCents(v.model.priceCents, 1 - discount * (1 - serviceDiscount));
  const trailerOptions = fleet.trailers.filter((t) => t.cityId === v.cityId && canCouple(v.model, t.model));
  const insurance = insurancePriceCents(v.model.priceCents + (v.trailer?.model.priceCents ?? 0));
  const repairButton = <ActionButton action={{ type: 'repairVehicle', vehicleId: v.id }} className="btn-primary" disabled={busy || repair <= 0}><Wrench className="h-4 w-4" />{tr('Ремонт · {0}', money(repair))}</ActionButton>;
  return (
    <div className="space-y-4 text-sm" data-testid="truck-service">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex justify-between text-xs text-mist-400"><span>{tr('Влекач / камион')}</span><span className="num">{Math.round(v.condition)}%</span></div>
          <Meter value={v.condition} className="mt-1" />
        </div>
        {v.trailer && (
          <div>
            <div className="flex justify-between text-xs text-mist-400"><span>{tr('Ремарке')}</span><span className="num">{Math.round(v.trailer.condition)}%</span></div>
            <Meter value={v.trailer.condition} className="mt-1" />
          </div>
        )}
      </div>
      {v.ownership === 'rented' ? (
        <div className="space-y-3 text-mist-300">
          <Badge tone="gold">{tr('Нает')}</Badge>
          <p>{tr('Поддръжката, ремонтите и горивото са за сметка на наемодателя. Наетите превозни средства не се модифицират и не се продават.')}</p>
        </div>
      ) : (
        <>
          {repairPanel ?? <div className="flex flex-wrap gap-2">{repairButton}</div>}
          {vipSave > 0 && <Link href="/game/shop" className="block text-xs text-gold-300 hover:underline" data-testid="vip-repair-hint">{tr('С VIP този ремонт е с {0} по-евтин →', money(vipSave))}</Link>}
          {features.maintenance && (
            <div className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2.5 ${upkeep.overdue ? 'border-loss/50 bg-loss/10' : 'border-asphalt-700'}`}>
              <span>
                <b>{tr('Профилактика')}</b>{' '}
                {upkeep.overdue ? <span className="text-loss">{tr('просрочена с {0} км — по-често повреди по пътя', int(-upkeep.dueInKm))}</span> : upkeep.fresh ? <span className="text-profit">{tr('току-що направена — по-малко инциденти')}</span> : <span className="text-mist-300">{tr('след {0} км', int(upkeep.dueInKm))}</span>}
              </span>
              {!upkeep.fresh && <ActionButton action={{ type: 'serviceVehicle', vehicleId: v.id }} className={upkeep.overdue ? 'btn-primary px-3 py-1.5 text-xs' : 'btn-ghost px-3 py-1.5 text-xs'} disabled={busy}>{tr('Направи · {0}', money(upkeepCost))}</ActionButton>}
            </div>
          )}
          {v.ownership === 'owned' && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-asphalt-700 bg-asphalt-850 px-3 py-2">
              <span className="flex min-w-0 items-center gap-2">
                <ShieldCheck className={`h-4 w-4 shrink-0 ${isInsured(v.insuredUntil, now) ? 'text-profit' : 'text-mist-400'}`} />
                {isInsured(v.insuredUntil, now) ? <span>{tr('Застрахован до {0}', dateTime(v.insuredUntil!))}</span> : <span className="text-mist-300">{tr('Без застраховка — пътната помощ при повреда е за твоя сметка')}</span>}
              </span>
              <ActionButton action={{ type: 'buyInsurance', vehicleId: v.id }} className="btn-ghost px-3 py-1.5 text-xs" disabled={ctx.balanceCents < insurance}>
                {tr('{0} 30 дни · {1}', isInsured(v.insuredUntil, now) ? tr('Удължи') : tr('Застраховай'), money(insurance))}
              </ActionButton>
            </div>
          )}
          {v.ownership === 'owned' && (v.model.kind === 'tractor' || (v.model.kind === 'rigid' && TRAILERS.some((t) => canCouple(v.model, t)))) && (
            <div>
              <div className="label mb-1.5">{tr('{0} (в {1})', v.model.kind === 'rigid' ? tr('Прикачно ремарке') : tr('Ремарке'), tx(v.city.nameBg))}</div>
              <SelectAction
                label={tr('Прикачи')}
                ariaLabel={tr('Ремарке')}
                value={v.trailer?.id ?? ''}
                options={[{ value: '', label: tr('— без ремарке —') }, ...trailerOptions.map((t) => ({ value: t.id, label: `${t.model.name} · ${t.plate}${t.vehicleId && t.vehicleId !== v.id ? tr(' (при друг камион)') : ''}` }))]}
                action={{ type: 'coupleTrailer', vehicleId: v.id }}
                field="trailerId"
              />
            </div>
          )}
        </>
      )}
      {!busy && ctx.myDepots.some((d) => d.cityId !== v.cityId) && (
        <div>
          <div className="label mb-1.5">{tr('Премести до депо (за 1 минута)')}</div>
          <SelectAction
            label={tr('Премести')}
            ariaLabel={tr('Депо за {0}', v.plate)}
            value=""
            options={[{ value: '', label: tr('— избери депо —') }, ...ctx.myDepots.filter((d) => d.cityId !== v.cityId).map((d) => ({ value: d.id, label: tx(d.name) }))]}
            action={{ type: 'moveToDepot', vehicleId: v.id }}
            field="depotId"
          />
          <p className="mt-1 text-xs text-mist-400">{tr('Безплатно, от всяка държава — без гориво, такси и износване. Прикаченото ремарке идва с него.')}</p>
        </div>
      )}
      {features.truck_names && v.ownership !== 'company' && <TruckNameForm vehicleId={v.id} nickname={v.nickname} />}
      {features.scrapyard && v.ownership === 'owned' && !v.delivery && v.status === 'idle' && (
        <div className="flex flex-wrap gap-2">
          {ctx.spareParts > 0 && v.condition < 100 && <ActionButton action={{ type: 'repairWithPart', vehicleId: v.id }} className="btn-ghost px-2 py-1 text-xs">{tr('Ремонт с част (+{0} %)', SCRAP.repairPerPart)}</ActionButton>}
          <ActionButton action={{ type: 'scrapVehicle', vehicleId: v.id }} className="btn-ghost px-2 py-1 text-xs" confirm={tr('Камионът отива за скрап: {0} и {1} резервни части. Не може да се върне.', money(Math.round(v.model.priceCents * SCRAP.share)), SCRAP.parts[v.model.kind] ?? 1)}>{tr('За скрап')}</ActionButton>
        </div>
      )}
    </div>
  );
}

/** The upgrades for this truck (own trucks only). */
export function TruckUpgradesPanel({ v, ctx }: { v: Vehicle; ctx: TruckPanelContext }) {
  const { discount, features, now } = ctx;
  if (v.ownership !== 'owned') return <p className="text-sm text-mist-300">{tr('Наетите и фирмените камиони не се модифицират.')}</p>;
  const busy = !!v.delivery || !!listingOf(ctx, v.id);
  return (
    <ul className="grid gap-2 sm:grid-cols-2" data-testid="truck-upgrades">
      {Object.values(UPGRADES)
        .filter((u) => u.appliesTo.includes(v.model.kind) && (features.seasonal_tyres || (u.id !== 'summer_tyres' && u.id !== 'all_season_tyres')))
        .map((u) => {
          const has = v.upgrades.includes(u.id);
          const off = winterTyreDiscount(u.id, now, !!features.winter_prep);
          const price = Math.round(u.priceCents * discount * (1 - off));
          return (
            <li key={u.id} className="rounded-xl border border-asphalt-700 bg-asphalt-850 p-3 text-sm">
              <div className="font-semibold">{tx(u.label)}</div>
              <div className="text-xs text-mist-400">{tx(u.description)}</div>
              <div className="mt-2">
                {has ? <Badge tone="violet">{tr('монтирано')}</Badge> : (
                  <ActionButton action={{ type: 'installUpgrade', vehicleId: v.id, upgradeId: u.id }} className="btn-ghost px-3 py-1.5 text-xs" disabled={busy || ctx.balanceCents < price}>
                    {tr('Монтирай · {0}', money(price))}{off > 0 && ` · −${Math.round(off * 100)}%`}
                  </ActionButton>
                )}
              </div>
            </li>
          );
        })}
    </ul>
  );
}

/** Sell now, list it for the players, or give a rented / company truck back. */
export function TruckSellPanel({ v, ctx }: { v: Vehicle; ctx: TruckPanelContext }) {
  const listing = listingOf(ctx, v.id);
  const busy = !!v.delivery || !!listing;
  if (v.ownership === 'rented') {
    return busy || v.driver?.isOwner ? <p className="text-sm text-mist-300">{tr('Наетият камион се връща, когато е свободен.')}</p> : <ActionButton action={{ type: 'returnRental', vehicleId: v.id }} className="btn-ghost" confirm={tr('Да върнем ли камиона?')}>{tr('Върни на наемодателя')}</ActionButton>;
  }
  if (v.ownership === 'company') {
    return busy ? <p className="text-sm text-mist-300">{tr('Камионът е на курс.')}</p> : <ActionButton action={{ type: 'returnOrgVehicle', vehicleId: v.id }} className="btn-ghost" confirm={tr('Да върнем ли камиона на компанията?')}>{tr('Върни на компанията')}</ActionButton>;
  }
  return (
    <div className="space-y-2 text-sm" data-testid="truck-sell">
      <div className="flex flex-wrap items-center gap-2">
        {listing ? (
          <>
            <Badge tone="gold">{tr('обявено · {0}', money(listing.priceCents))}</Badge>
            <ActionButton action={{ type: 'cancelListing', listingId: listing.id }} className="btn-ghost">{tr('Свали обявата')}</ActionButton>
          </>
        ) : (
          <>
            <ActionButton action={{ type: 'sellVehicle', vehicleId: v.id }} className="btn-danger" confirm={tr('Продажба на търговец за {0}?', money(v.resaleCents))} disabled={busy}>
              {tr('Продай веднага · {0}', money(v.resaleCents))}
            </ActionButton>
            <ListForSale kind="vehicle" itemId={v.id} bounds={boundsFor('vehicle', v, ctx.now)} feeShare={USED_MARKET.feeShare} disabled={busy} />
          </>
        )}
      </div>
      {listing ? <p className="text-xs text-mist-400">{tr('Докато е обявено, превозното средство не поема поръчки. Обявата изтича на {0}.', dateTime(listing.expiresAt))}</p> : <p className="text-xs text-mist-400">{tr('„Продай“ е веднага на търговец. Обявата на пазара е за играчите (такса 5%, до 7 дни) — дотогава камионът не кара.')}</p>}
    </div>
  );
}

/** 1.3.3: the trailers (Автопарк → Ремаркета): where each one is, sell or list it, its upgrades. */
export function TrailersPanel({ fleet, ctx }: { fleet: Fleet; ctx: TruckPanelContext }) {
  const discount = ctx.discount;
  return (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {fleet.trailers.filter((t) => t.ownership !== 'rented').map((t) => {
        const tractor = fleet.vehicles.find((v) => v.id === t.vehicleId);
        const listing = listingOf(ctx, t.id);
        return (
          <li key={t.id} className="rounded-xl border border-asphalt-700 bg-asphalt-850 p-3 text-sm">
            <TrailerIllustration modelId={t.modelId} upgrades={t.upgrades} logo={t.logo} cosmetics={t.cosmetics} className="h-14 w-full" />
            <div className="mt-2 flex items-center justify-between"><span className="font-semibold">{tx(t.model.name)}</span><span className="font-mono text-xs text-mist-400">{tx(t.plate)}</span></div>
            <div className="mt-1 text-xs text-mist-400">{tractor ? tr('Прикачено към {0}', tractor.plate) : tr('Паркирано в {0}', t.city.nameBg)} · {Math.round(t.condition)}%</div>
            {t.ownership === 'company' ? (
              <div className="mt-2 space-y-2">
                <Badge tone="cyan">{tr('Фирмено')}</Badge>
                <p className="text-xs text-mist-400">{tr('Ремарке на компанията: курсовете с него носят бонус за касата и повече опит за компанията.')}</p>
                <ActionButton action={{ type: 'returnOrgTrailer', trailerId: t.id }} className="btn-ghost px-3 py-1.5 text-xs" confirm={tr('Да върнем ли ремаркето на компанията?')} disabled={!!tractor?.delivery}>{tr('Върни на компанията')}</ActionButton>
              </div>
            ) : t.ownership === 'hired' || t.hiredOut ? (
              <div className="mt-2 space-y-1">
                <Badge tone="violet">{t.ownership === 'hired' ? tr('наето от играч') : tr('дадено под наем')}</Badge>
              </div>
            ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {listing ? (
                <>
                  <Badge tone="gold">{tr('обявено · {0}', money(listing.priceCents))}</Badge>
                  <ActionButton action={{ type: 'cancelListing', listingId: listing.id }} className="btn-ghost px-3 py-1.5 text-xs">{tr('Свали обявата')}</ActionButton>
                </>
              ) : (
                <>
                  <ActionButton action={{ type: 'sellTrailer', trailerId: t.id }} className="btn-danger px-3 py-1.5 text-xs" confirm={tr('Продажба на търговец за {0}?', money(t.resaleCents))} disabled={!!tractor?.delivery}>
                    {tr('Продай веднага · {0}', money(t.resaleCents))}
                  </ActionButton>
                  <ListForSale kind="trailer" itemId={t.id} small bounds={boundsFor('trailer', t, ctx.now)} feeShare={USED_MARKET.feeShare} disabled={!!tractor?.delivery} />
                </>
              )}
            </div>
            )}
            {ctx.features.trailer_upgrades && t.ownership === 'owned' && (
              <ul className="mt-3 space-y-1.5">
                {Object.values(TRAILER_UPGRADES).filter((u) => !u.bodies || u.bodies.includes(t.model.body)).map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-2 rounded-lg border border-asphalt-700 px-2 py-1.5 text-xs">
                    <span className="min-w-0"><b>{tx(u.label)}</b><span className="block text-mist-400">{tx(u.description)}</span></span>
                    {t.upgrades.includes(u.id) ? <Badge tone="violet">{tr('монтирано')}</Badge> : (
                      <ActionButton action={{ type: 'trailerUpgrade', trailerId: t.id, upgradeId: u.id }} className="btn-ghost shrink-0 px-2 py-1 text-xs" disabled={!!tractor?.delivery || !!listing || ctx.balanceCents < Math.round(u.priceCents * discount)}>
                        {money(Math.round(u.priceCents * discount))}
                      </ActionButton>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

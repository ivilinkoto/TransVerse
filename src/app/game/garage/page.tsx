import Link from 'next/link';
import { Hint } from '@/components/game/Hint';
import { maintenanceCostCents, maintenanceState } from '@/lib/game/maintenance';
import { bonusesForUser } from '@/server/game/membership';
import { ShieldCheck, Wrench } from 'lucide-react';
import { insurancePriceCents, isInsured } from '@/lib/game/fines';
import { Badge, Card, Empty, Meter, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { SelectAction } from '@/components/ui/SelectAction';
import { TrailerIllustration, VehicleIllustration } from '@/components/vehicles/VehicleIllustration';
import { dateTime, int, money } from '@/lib/format';
import { USED_MARKET } from '@/lib/game/used-market';
import { ListForSale } from '@/components/game/ListForSale';
import { boundsFor, myListings } from '@/server/game/used-market';
import { TRAILERS, TRAILER_UPGRADES, UPGRADES, canCouple } from '@/lib/game/catalog';
import { eq } from 'drizzle-orm';
import { cities, depots } from '@/server/db/schema';
import { repairCostCents } from '@/lib/game/economy';
import { isVip, VIP_PERKS } from '@/lib/game/vip';
import { gameContext } from '@/server/game/context';
import { fleetView } from '@/server/game/queries';
import { isMarta, springDiscount } from '@/lib/game/marta';

export const metadata = { title: 'Сервиз' };

export default async function GaragePage() {
  const { db, user, company, now, features } = await gameContext();
  // Баба Марта (v1.5): martenitsas on the trucks in March.
  const marta = features.marta && isMarta(now);
  // VIP: discount on repairs and upgrades; the company's service on the plot makes repairs cheaper too.
  const discount = isVip(user.vipUntil, now) ? 1 - VIP_PERKS.garageDiscount : 1;
  // The company's service and, in March, spring cleaning (Баба Марта) make repairs cheaper.
  const serviceDiscount = 1 - (1 - ((await bonusesForUser(db, user.id))?.bonuses.repairDiscount ?? 0)) * (1 - (features.marta ? springDiscount(now) : 0));
  const [fleet, listings, myDepots] = await Promise.all([fleetView(db, company.id), myListings(db, company.id), db.select({ id: depots.id, cityId: depots.cityId, name: cities.nameBg }).from(depots).innerJoin(cities, eq(cities.id, depots.cityId)).where(eq(depots.companyId, company.id))]);
  const insurance = new Map(fleet.vehicles.map((v) => [v.id, insurancePriceCents(v.model.priceCents + (v.trailer?.model.priceCents ?? 0))]));
  const listingOf = (id: string) => listings.find((l) => l.vehicleId === id || l.trailerId === id);

  return (
    <div className="space-y-6">
      <PageHeader title="Сервиз" subtitle="Ремонти, подобрения, ремаркета и продажба — между курсовете."
        help="Продажбата веднага става на търговец. Ако обявиш техниката на пазара, друг играч може да я купи на твоята цена (такса 5%); докато е обявена, не кара. Обявата изтича след 7 дни." />
      {!user.seenHints.includes('insurance') && <Hint id="insurance" />}
      {fleet.vehicles.length === 0 && <Empty icon={Wrench} title="Няма техника за сервиз" />}
      <div className="space-y-4">
        {fleet.vehicles.map((v) => {
          const listing = listingOf(v.id);
          const busy = !!v.delivery || !!listing;
          const repair = Math.round((repairCostCents(v.model.priceCents, v.condition) + (v.trailer ? repairCostCents(v.trailer.model.priceCents, v.trailer.condition) : 0)) * discount * (1 - serviceDiscount));
          const upkeep = maintenanceState(v.odometerKm, v.serviceKm);
          const upkeepCost = maintenanceCostCents(v.model.priceCents, 1 - discount * (1 - serviceDiscount));
          const trailerOptions = fleet.trailers.filter((t) => t.cityId === v.cityId && canCouple(v.model, t.model));
          return (
            <Card key={v.id}>
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-lg font-bold">{v.model.name}</span>
                    <span className="font-mono text-xs text-mist-400">{v.plate}</span>
                    {features.garage_showcase && <Link href={`/game/garage/${v.id}`} className="text-xs text-cyan-glow hover:underline">Витрина →</Link>}
                    {listing ? <Badge tone="gold">обявено · {money(listing.priceCents)}</Badge> : v.delivery ? <Badge tone="cyan">на курс</Badge> : v.movingUntil && v.movingUntil > now ? <Badge tone="orange">пътува до {v.city.nameBg} · до минута</Badge> : <Badge tone="green">в {v.city.nameBg}</Badge>}
                  </div>
                  <VehicleIllustration modelId={v.modelId} trailerModelId={v.trailer?.modelId} color={v.color} livery={v.livery} cosmetics={v.cosmetics} trailerUpgrades={v.trailer?.upgrades} trailerLogo={v.trailer?.logo} trailerCosmetics={v.trailer?.cosmetics} martenitsa={marta} className="my-3 h-24 w-full" />
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="flex justify-between text-xs text-mist-400"><span>Влекач / камион</span><span className="num">{Math.round(v.condition)}%</span></div>
                      <Meter value={v.condition} className="mt-1" />
                    </div>
                    {v.trailer && (
                      <div>
                        <div className="flex justify-between text-xs text-mist-400"><span>Ремарке</span><span className="num">{Math.round(v.trailer.condition)}%</span></div>
                        <Meter value={v.trailer.condition} className="mt-1" />
                      </div>
                    )}
                  </div>
                  {!v.delivery && !listing && myDepots.some((d) => d.cityId !== v.cityId) && (
                    <div className="mt-3">
                      <div className="label mb-1.5">Премести до депо (за 1 минута)</div>
                      <SelectAction
                        label="Премести"
                        ariaLabel={`Депо за ${v.plate}`}
                        value=""
                        options={[{ value: '', label: '— избери депо —' }, ...myDepots.filter((d) => d.cityId !== v.cityId).map((d) => ({ value: d.id, label: d.name }))]}
                        action={{ type: 'moveToDepot', vehicleId: v.id }}
                        field="depotId"
                      />
                      <p className="mt-1 text-xs text-mist-400">Плащаш горивото, таксите и износването за пътя (по истинския маршрут). Прикаченото ремарке идва с него.</p>
                    </div>
                  )}
                  {features.maintenance && v.ownership !== 'rented' && (
                    <div className={`mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2.5 text-sm ${upkeep.overdue ? 'border-loss/50 bg-loss/10' : 'border-asphalt-700'}`}>
                      <span>
                        <b>Профилактика</b>{' '}
                        {upkeep.overdue ? <span className="text-loss">просрочена с {int(-upkeep.dueInKm)} км — по-често повреди по пътя</span> : upkeep.fresh ? <span className="text-profit">току-що направена — по-малко инциденти</span> : <span className="text-mist-300">след {int(upkeep.dueInKm)} км</span>}
                      </span>
                      {!upkeep.fresh && <ActionButton action={{ type: 'serviceVehicle', vehicleId: v.id }} className={upkeep.overdue ? 'btn-primary px-3 py-1.5 text-xs' : 'btn-ghost px-3 py-1.5 text-xs'} disabled={busy}>Направи · {money(upkeepCost)}</ActionButton>}
                    </div>
                  )}
                </div>
                {v.ownership === 'rented' ? (
                  <div className="space-y-3 text-sm text-mist-300">
                    <Badge tone="gold">Нает</Badge>
                    <p>Поддръжката, ремонтите и горивото са за сметка на наемодателя. Наетите превозни средства не се модифицират и не се продават.</p>
                    {!busy && !v.driver?.isOwner && <ActionButton action={{ type: 'returnRental', vehicleId: v.id }} className="btn-ghost" confirm="Да върнем ли камиона?">Върни на наемодателя</ActionButton>}
                  </div>
                ) : v.ownership === 'company' ? (
                  <div className="space-y-3 text-sm text-mist-300">
                    <Badge tone="cyan">Фирмен</Badge>
                    <p>Камион на компанията. Горивото и ремонтите са твои, докато го караш; не се модифицира и не се продава.</p>
                    <div className="flex flex-wrap gap-2">
                      <ActionButton action={{ type: 'repairVehicle', vehicleId: v.id }} className="btn-primary" disabled={busy || repair <= 0}><Wrench className="h-4 w-4" />Ремонт · {money(repair)}</ActionButton>
                      {!busy && <ActionButton action={{ type: 'returnOrgVehicle', vehicleId: v.id }} className="btn-ghost" confirm="Да върнем ли камиона на компанията?">Върни на компанията</ActionButton>}
                    </div>
                  </div>
                ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <ActionButton action={{ type: 'repairVehicle', vehicleId: v.id }} className="btn-primary" disabled={busy || repair <= 0}>
                      <Wrench className="h-4 w-4" />Ремонт · {money(repair)}
                    </ActionButton>
                    {listing ? (
                      <ActionButton action={{ type: 'cancelListing', listingId: listing.id }} className="btn-ghost">Свали обявата</ActionButton>
                    ) : (
                      <>
                        <ActionButton action={{ type: 'sellVehicle', vehicleId: v.id }} className="btn-danger" confirm={`Продажба на търговец за ${money(v.resaleCents)}?`} disabled={busy}>
                          Продай веднага · {money(v.resaleCents)}
                        </ActionButton>
                        <ListForSale kind="vehicle" itemId={v.id} bounds={boundsFor('vehicle', v, now)} feeShare={USED_MARKET.feeShare} disabled={busy} />
                      </>
                    )}
                  </div>
                  {listing && <p className="text-xs text-mist-400">Докато е обявено, превозното средство не поема поръчки. Обявата изтича на {dateTime(listing.expiresAt)}.</p>}
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-asphalt-700 bg-asphalt-850 px-3 py-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <ShieldCheck className={`h-4 w-4 shrink-0 ${isInsured(v.insuredUntil, now) ? 'text-profit' : 'text-mist-400'}`} />
                      {isInsured(v.insuredUntil, now) ? <span>Застрахован до {dateTime(v.insuredUntil!)}</span> : <span className="text-mist-300">Без застраховка — пътната помощ при повреда е за твоя сметка</span>}
                    </span>
                    <ActionButton action={{ type: 'buyInsurance', vehicleId: v.id }} className="btn-ghost px-3 py-1.5 text-xs" disabled={company.balanceCents < insurance.get(v.id)!}>
                      {isInsured(v.insuredUntil, now) ? 'Удължи' : 'Застраховай'} 30 дни · {money(insurance.get(v.id)!)}
                    </ActionButton>
                  </div>
                  {(v.model.kind === 'tractor' || (v.model.kind === 'rigid' && TRAILERS.some((t) => canCouple(v.model, t)))) && (
                    <div>
                      <div className="label mb-1.5">{v.model.kind === 'rigid' ? 'Прикачно ремарке' : 'Ремарке'} (в {v.city.nameBg})</div>
                      <SelectAction
                        label="Прикачи"
                        ariaLabel="Ремарке"
                        value={v.trailer?.id ?? ''}
                        options={[{ value: '', label: '— без ремарке —' }, ...trailerOptions.map((t) => ({ value: t.id, label: `${t.model.name} · ${t.plate}${t.vehicleId && t.vehicleId !== v.id ? ' (при друг камион)' : ''}` }))]}
                        action={{ type: 'coupleTrailer', vehicleId: v.id }}
                        field="trailerId"
                      />
                    </div>
                  )}
                  <div>
                    <div className="label mb-1.5">Подобрения</div>
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {Object.values(UPGRADES)
                        .filter((u) => u.appliesTo.includes(v.model.kind) && (features.seasonal_tyres || (u.id !== 'summer_tyres' && u.id !== 'all_season_tyres')))
                        .map((u) => {
                          const has = v.upgrades.includes(u.id);
                          return (
                            <li key={u.id} className="rounded-xl border border-asphalt-700 bg-asphalt-850 p-3 text-sm">
                              <div className="font-semibold">{u.label}</div>
                              <div className="text-xs text-mist-400">{u.description}</div>
                              <div className="mt-2">
                                {has ? <Badge tone="violet">монтирано</Badge> : (
                                  <ActionButton action={{ type: 'installUpgrade', vehicleId: v.id, upgradeId: u.id }} className="btn-ghost px-3 py-1.5 text-xs" disabled={busy || company.balanceCents < Math.round(u.priceCents * discount)}>
                                    Монтирай · {money(Math.round(u.priceCents * discount))}
                                  </ActionButton>
                                )}
                              </div>
                            </li>
                          );
                        })}
                    </ul>
                  </div>
                </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {fleet.trailers.length > 0 && (
        <Card title="Ремаркета">
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {fleet.trailers.filter((t) => t.ownership !== 'rented').map((t) => {
              const tractor = fleet.vehicles.find((v) => v.id === t.vehicleId);
              const listing = listingOf(t.id);
              return (
                <li key={t.id} className="rounded-xl border border-asphalt-700 bg-asphalt-850 p-3 text-sm">
                  <TrailerIllustration modelId={t.modelId} upgrades={t.upgrades} logo={t.logo} cosmetics={t.cosmetics} className="h-14 w-full" />
                  <div className="mt-2 flex items-center justify-between"><span className="font-semibold">{t.model.name}</span><span className="font-mono text-xs text-mist-400">{t.plate}</span></div>
                  <div className="mt-1 text-xs text-mist-400">{tractor ? `Прикачено към ${tractor.plate}` : `Паркирано в ${t.city.nameBg}`} · {Math.round(t.condition)}%</div>
                  {t.ownership === 'company' ? (
                    <div className="mt-2 space-y-2">
                      <Badge tone="cyan">Фирмено</Badge>
                      <p className="text-xs text-mist-400">Ремарке на компанията: курсовете с него носят бонус за касата и повече опит за компанията.</p>
                      <ActionButton action={{ type: 'returnOrgTrailer', trailerId: t.id }} className="btn-ghost px-3 py-1.5 text-xs" confirm="Да върнем ли ремаркето на компанията?" disabled={!!tractor?.delivery}>Върни на компанията</ActionButton>
                    </div>
                  ) : t.ownership === 'hired' || t.hiredOut ? (
                    <div className="mt-2 space-y-1">
                      <Badge tone="violet">{t.ownership === 'hired' ? 'наето от играч' : 'дадено под наем'}</Badge>
                      <p className="text-xs text-mist-400"><Link href="/game/trailer-hire" className="underline">Ремаркета под наем</Link></p>
                    </div>
                  ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {listing ? (
                      <>
                        <Badge tone="gold">обявено · {money(listing.priceCents)}</Badge>
                        <ActionButton action={{ type: 'cancelListing', listingId: listing.id }} className="btn-ghost px-3 py-1.5 text-xs">Свали обявата</ActionButton>
                      </>
                    ) : (
                      <>
                        <ActionButton action={{ type: 'sellTrailer', trailerId: t.id }} className="btn-danger px-3 py-1.5 text-xs" confirm={`Продажба на търговец за ${money(t.resaleCents)}?`} disabled={!!tractor?.delivery}>
                          Продай веднага · {money(t.resaleCents)}
                        </ActionButton>
                        <ListForSale kind="trailer" itemId={t.id} small bounds={boundsFor('trailer', t, now)} feeShare={USED_MARKET.feeShare} disabled={!!tractor?.delivery} />
                      </>
                    )}
                  </div>
                  )}
                  {features.trailer_upgrades && t.ownership === 'owned' && (
                    <ul className="mt-3 space-y-1.5">
                      {Object.values(TRAILER_UPGRADES).filter((u) => !u.bodies || u.bodies.includes(t.model.body)).map((u) => (
                        <li key={u.id} className="flex items-center justify-between gap-2 rounded-lg border border-asphalt-700 px-2 py-1.5 text-xs">
                          <span className="min-w-0"><b>{u.label}</b><span className="block text-mist-400">{u.description}</span></span>
                          {t.upgrades.includes(u.id) ? <Badge tone="violet">монтирано</Badge> : (
                            <ActionButton action={{ type: 'trailerUpgrade', trailerId: t.id, upgradeId: u.id }} className="btn-ghost shrink-0 px-2 py-1 text-xs" disabled={!!tractor?.delivery || !!listing || company.balanceCents < Math.round(u.priceCents * discount)}>
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
        </Card>
      )}
    </div>
  );
}

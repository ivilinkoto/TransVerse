import { TruckNameForm } from '@/components/game/TruckNameForm';
import { SCRAP } from '@/lib/game/heritage';
import { sparePartsOf } from '@/server/game/heritage';
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
import { t as tr, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Сервиз') };
}

export default async function GaragePage() {
  await initLocale();
  const { db, user, company, now, features } = await gameContext();
  // Баба Марта (v1.5): martenitsas on the trucks in March.
  const marta = features.marta && isMarta(now);
  // VIP: discount on repairs and upgrades; the company's service on the plot makes repairs cheaper too.
  const discount = isVip(user.vipUntil, now) ? 1 - VIP_PERKS.garageDiscount : 1;
  // The company's service and, in March, spring cleaning (Баба Марта) make repairs cheaper.
  const serviceDiscount = 1 - (1 - ((await bonusesForUser(db, user.id))?.bonuses.repairDiscount ?? 0)) * (1 - (features.marta ? springDiscount(now) : 0));
  const [fleet, listings, myDepots, spareParts] = await Promise.all([fleetView(db, company.id), myListings(db, company.id), db.select({ id: depots.id, cityId: depots.cityId, name: cities.nameBg }).from(depots).innerJoin(cities, eq(cities.id, depots.cityId)).where(eq(depots.companyId, company.id)), features.scrapyard ? sparePartsOf(db, user.id) : 0]);
  const insurance = new Map(fleet.vehicles.map((v) => [v.id, insurancePriceCents(v.model.priceCents + (v.trailer?.model.priceCents ?? 0))]));
  const listingOf = (id: string) => listings.find((l) => l.vehicleId === id || l.trailerId === id);

  return (
    <div className="space-y-6">
      <PageHeader title={tr('Сервиз')} subtitle={tr('Ремонти, подобрения, ремаркета и продажба — между курсовете.')}
        help={tr('Продажбата веднага става на търговец. Ако обявиш техниката на пазара, друг играч може да я купи на твоята цена (такса 5%); докато е обявена, не кара. Обявата изтича след 7 дни.')} />
      {!user.seenHints.includes('insurance') && <Hint id="insurance" />}
      {fleet.vehicles.length === 0 && <Empty icon={Wrench} title={tr('Няма техника за сервиз')} />}
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
                    <span className="font-display text-lg font-bold">{tx(v.model.name)}</span>
                    <span className="font-mono text-xs text-mist-400">{v.nickname && <span className="font-sans font-semibold text-mist-200">„{v.nickname}“ · </span>}{tx(v.plate)}</span>
                    {features.garage_showcase && <Link href={`/game/garage/${v.id}`} className="text-xs text-cyan-glow hover:underline">{tr('Витрина →')}</Link>}
                    {features.scrapyard && v.ownership === 'owned' && !v.delivery && v.status === 'idle' && (
                      <>
                        {spareParts > 0 && v.condition < 100 && <ActionButton action={{ type: 'repairWithPart', vehicleId: v.id }} className="btn-ghost px-2 py-1 text-xs">{tr('Ремонт с част (+{0} %)', SCRAP.repairPerPart)}</ActionButton>}
                        <ActionButton action={{ type: 'scrapVehicle', vehicleId: v.id }} className="btn-ghost px-2 py-1 text-xs" confirm={tr('Камионът отива за скрап: {0} и {1} резервни части. Не може да се върне.', money(Math.round(v.model.priceCents * SCRAP.share)), SCRAP.parts[v.model.kind] ?? 1)}>{tr('За скрап')}</ActionButton>
                      </>
                    )}
                    {listing ? <Badge tone="gold">{tr('обявено · {0}', money(listing.priceCents))}</Badge> : v.delivery ? <Badge tone="cyan">{tr('на курс')}</Badge> : v.movingUntil && v.movingUntil > now ? <Badge tone="orange">{tr('пътува до {0} · до минута', v.city.nameBg)}</Badge> : <Badge tone="green">{tr('в {0}', v.city.nameBg)}</Badge>}
                  </div>
                  {features.truck_names && v.ownership !== 'company' && <div className="mt-2"><TruckNameForm vehicleId={v.id} nickname={v.nickname} /></div>}
                  <VehicleIllustration modelId={v.modelId} trailerModelId={v.trailer?.modelId} color={v.color} livery={v.livery} cosmetics={v.cosmetics} trailerUpgrades={v.trailer?.upgrades} trailerLogo={v.trailer?.logo} trailerCosmetics={v.trailer?.cosmetics} martenitsa={marta} className="my-3 h-24 w-full" />
                  <div className="grid grid-cols-2 gap-4 text-sm">
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
                  {!v.delivery && !listing && myDepots.some((d) => d.cityId !== v.cityId) && (
                    <div className="mt-3">
                      <div className="label mb-1.5">{tr('Премести до депо (за 1 минута)')}</div>
                      <SelectAction
                        label={tr('Премести')}
                        ariaLabel={tr('Депо за {0}', v.plate)}
                        value=""
                        options={[{ value: '', label: tr('— избери депо —') }, ...myDepots.filter((d) => d.cityId !== v.cityId).map((d) => ({ value: d.id, label: d.name }))]}
                        action={{ type: 'moveToDepot', vehicleId: v.id }}
                        field="depotId"
                      />
                      <p className="mt-1 text-xs text-mist-400">{tr('Плащаш горивото, таксите и износването за пътя (по истинския маршрут). Прикаченото ремарке идва с него.')}</p>
                    </div>
                  )}
                  {features.maintenance && v.ownership !== 'rented' && (
                    <div className={`mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2.5 text-sm ${upkeep.overdue ? 'border-loss/50 bg-loss/10' : 'border-asphalt-700'}`}>
                      <span>
                        <b>{tr('Профилактика')}</b>{' '}
                        {upkeep.overdue ? <span className="text-loss">{tr('просрочена с {0} км — по-често повреди по пътя', int(-upkeep.dueInKm))}</span> : upkeep.fresh ? <span className="text-profit">{tr('току-що направена — по-малко инциденти')}</span> : <span className="text-mist-300">{tr('след {0} км', int(upkeep.dueInKm))}</span>}
                      </span>
                      {!upkeep.fresh && <ActionButton action={{ type: 'serviceVehicle', vehicleId: v.id }} className={upkeep.overdue ? 'btn-primary px-3 py-1.5 text-xs' : 'btn-ghost px-3 py-1.5 text-xs'} disabled={busy}>{tr('Направи · {0}', money(upkeepCost))}</ActionButton>}
                    </div>
                  )}
                </div>
                {v.ownership === 'rented' ? (
                  <div className="space-y-3 text-sm text-mist-300">
                    <Badge tone="gold">{tr('Нает')}</Badge>
                    <p>{tr('Поддръжката, ремонтите и горивото са за сметка на наемодателя. Наетите превозни средства не се модифицират и не се продават.')}</p>
                    {!busy && !v.driver?.isOwner && <ActionButton action={{ type: 'returnRental', vehicleId: v.id }} className="btn-ghost" confirm={tr('Да върнем ли камиона?')}>{tr('Върни на наемодателя')}</ActionButton>}
                  </div>
                ) : v.ownership === 'company' ? (
                  <div className="space-y-3 text-sm text-mist-300">
                    <Badge tone="cyan">{tr('Фирмен')}</Badge>
                    <p>{tr('Камион на компанията. Горивото и ремонтите са твои, докато го караш; не се модифицира и не се продава.')}</p>
                    <div className="flex flex-wrap gap-2">
                      <ActionButton action={{ type: 'repairVehicle', vehicleId: v.id }} className="btn-primary" disabled={busy || repair <= 0}><Wrench className="h-4 w-4" />{tr('Ремонт · {0}', money(repair))}</ActionButton>
                      {!busy && <ActionButton action={{ type: 'returnOrgVehicle', vehicleId: v.id }} className="btn-ghost" confirm={tr('Да върнем ли камиона на компанията?')}>{tr('Върни на компанията')}</ActionButton>}
                    </div>
                  </div>
                ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <ActionButton action={{ type: 'repairVehicle', vehicleId: v.id }} className="btn-primary" disabled={busy || repair <= 0}>
                      <Wrench className="h-4 w-4" />{tr('Ремонт · {0}', money(repair))}
                    </ActionButton>
                    {listing ? (
                      <ActionButton action={{ type: 'cancelListing', listingId: listing.id }} className="btn-ghost">{tr('Свали обявата')}</ActionButton>
                    ) : (
                      <>
                        <ActionButton action={{ type: 'sellVehicle', vehicleId: v.id }} className="btn-danger" confirm={tr('Продажба на търговец за {0}?', money(v.resaleCents))} disabled={busy}>
                          {tr('Продай веднага · {0}', money(v.resaleCents))}
                        </ActionButton>
                        <ListForSale kind="vehicle" itemId={v.id} bounds={boundsFor('vehicle', v, now)} feeShare={USED_MARKET.feeShare} disabled={busy} />
                      </>
                    )}
                  </div>
                  {listing && <p className="text-xs text-mist-400">{tr('Докато е обявено, превозното средство не поема поръчки. Обявата изтича на {0}.', dateTime(listing.expiresAt))}</p>}
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-asphalt-700 bg-asphalt-850 px-3 py-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <ShieldCheck className={`h-4 w-4 shrink-0 ${isInsured(v.insuredUntil, now) ? 'text-profit' : 'text-mist-400'}`} />
                      {isInsured(v.insuredUntil, now) ? <span>{tr('Застрахован до {0}', dateTime(v.insuredUntil!))}</span> : <span className="text-mist-300">{tr('Без застраховка — пътната помощ при повреда е за твоя сметка')}</span>}
                    </span>
                    <ActionButton action={{ type: 'buyInsurance', vehicleId: v.id }} className="btn-ghost px-3 py-1.5 text-xs" disabled={company.balanceCents < insurance.get(v.id)!}>
                      {tr('{0} 30 дни · {1}', isInsured(v.insuredUntil, now) ? tr('Удължи') : tr('Застраховай'), money(insurance.get(v.id)!))}
                    </ActionButton>
                  </div>
                  {(v.model.kind === 'tractor' || (v.model.kind === 'rigid' && TRAILERS.some((t) => canCouple(v.model, t)))) && (
                    <div>
                      <div className="label mb-1.5">{tr('{0} (в {1})', v.model.kind === 'rigid' ? tr('Прикачно ремарке') : tr('Ремарке'), v.city.nameBg)}</div>
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
                  <div>
                    <div className="label mb-1.5">{tr('Подобрения')}</div>
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {Object.values(UPGRADES)
                        .filter((u) => u.appliesTo.includes(v.model.kind) && (features.seasonal_tyres || (u.id !== 'summer_tyres' && u.id !== 'all_season_tyres')))
                        .map((u) => {
                          const has = v.upgrades.includes(u.id);
                          return (
                            <li key={u.id} className="rounded-xl border border-asphalt-700 bg-asphalt-850 p-3 text-sm">
                              <div className="font-semibold">{tx(u.label)}</div>
                              <div className="text-xs text-mist-400">{tx(u.description)}</div>
                              <div className="mt-2">
                                {has ? <Badge tone="violet">{tr('монтирано')}</Badge> : (
                                  <ActionButton action={{ type: 'installUpgrade', vehicleId: v.id, upgradeId: u.id }} className="btn-ghost px-3 py-1.5 text-xs" disabled={busy || company.balanceCents < Math.round(u.priceCents * discount)}>
                                    {tr('Монтирай · {0}', money(Math.round(u.priceCents * discount)))}
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
        <Card title={tr('Ремаркета')}>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {fleet.trailers.filter((t) => t.ownership !== 'rented').map((t) => {
              const tractor = fleet.vehicles.find((v) => v.id === t.vehicleId);
              const listing = listingOf(t.id);
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
                      <p className="text-xs text-mist-400"><Link href="/game/trailer-hire" className="underline">{tr('Ремаркета под наем')}</Link></p>
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
                        <ListForSale kind="trailer" itemId={t.id} small bounds={boundsFor('trailer', t, now)} feeShare={USED_MARKET.feeShare} disabled={!!tractor?.delivery} />
                      </>
                    )}
                  </div>
                  )}
                  {features.trailer_upgrades && t.ownership === 'owned' && (
                    <ul className="mt-3 space-y-1.5">
                      {Object.values(TRAILER_UPGRADES).filter((u) => !u.bodies || u.bodies.includes(t.model.body)).map((u) => (
                        <li key={u.id} className="flex items-center justify-between gap-2 rounded-lg border border-asphalt-700 px-2 py-1.5 text-xs">
                          <span className="min-w-0"><b>{tx(u.label)}</b><span className="block text-mist-400">{tx(u.description)}</span></span>
                          {t.upgrades.includes(u.id) ? <Badge tone="violet">{tr('монтирано')}</Badge> : (
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

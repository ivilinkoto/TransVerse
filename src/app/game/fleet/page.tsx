import { LEGEND, legendTier } from '@/lib/game/heritage';
import { BadgeEuro, Gauge, MapPin, Truck, UserRound, Warehouse, Wrench } from 'lucide-react';
import { leasesOf } from '@/server/game/leasing';
import { and, desc, eq, sql } from 'drizzle-orm';
import { cities, depots, ledgerEntries } from '@/server/db/schema';
import { fleetCapacity } from '@/server/game/fleet';
import Link from 'next/link';
import { DeliveryProgress } from '@/components/game/DeliveryProgress';
import { RoadsideChoice } from '@/components/game/RoadsideChoice';
import { helpableStop } from '@/lib/game/roadside';
import { Badge, Card, Empty, Meter, PageHeader } from '@/components/ui';
import { TrailerIllustration, VehicleIllustration } from '@/components/vehicles/VehicleIllustration';
import { dec, int, km, money } from '@/lib/format';
import { BODY_LABELS } from '@/server/game/deliveries';
import { gameContext } from '@/server/game/context';
import { fleetView } from '@/server/game/queries';
import { ghostsFor } from '@/server/game/deals';
import { RENTAL_BUYOUT_DELIVERIES, UPGRADES, combinationCapability, type UpgradeId } from '@/lib/game/catalog';
import { ActionButton } from '@/components/ui/ActionButton';
import { CopyText } from '@/components/ui/CopyText';
import { SelectAction } from '@/components/ui/SelectAction';
import { ECONOMY } from '@/lib/game/economy';
import { isVip } from '@/lib/game/vip';
import { AUTO_DISPATCH_PER_DAY } from '@/server/game/dispatch';
import { isMarta } from '@/lib/game/marta';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Автопарк') };
}

const KIND = { van: 'Ван', rigid: 'Соло камион', tractor: 'Влекач' } as const;

import { RoadChoices } from '@/components/game/RoadChoices';
import { t as tr, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export default async function FleetPage() {
  await initLocale();
  const { db, user, company, now, features } = await gameContext();
  // Баба Марта (v1.5): martenitsas on the trucks in March.
  const marta = features.marta && isMarta(now);
  const vip = isVip(user.vipUntil, now);
  const fleet = await fleetView(db, company.id);
  // v1.8: the ghost of this month's record on each lane being driven.
  const ghosts = features.ghost_record ? await ghostsFor(db, fleet.vehicles.flatMap((v) => (v.delivery ? [{ originCityId: v.delivery.contract.originCityId, destCityId: v.delivery.contract.destCityId }] : [])), now) : new Map();
  const leased = new Map((features.leasing ? await leasesOf(db, company.id) : []).filter((l) => l.status === 'active').map((l) => [l.vehicleId, l]));
  const loose = fleet.trailers.filter((t) => !t.vehicleId);
  // The player drives one truck themselves and can switch to another idle one.
  const self = fleet.drivers.find((d) => d.isOwner);
  const selfBusy = !!self?.vehicleId && fleet.vehicles.some((x) => x.id === self.vehicleId && x.status !== 'idle');
  // 1.1.3: the depots at a glance (where own trucks are bought and parked).
  const [myDepots, capacity] = await Promise.all([
    db.select({ id: depots.id, cityId: depots.cityId, name: cities.nameBg, slots: depots.slots }).from(depots).innerJoin(cities, eq(cities.id, depots.cityId)).where(eq(depots.companyId, company.id)),
    fleetCapacity(db, company.id),
  ]);
  // 1.1.3.5: free trucks away from every depot ("Всички свободни в депото").
  const depotCities = new Set(myDepots.map((d) => d.cityId));
  const awayIdle = myDepots.length ? fleet.vehicles.filter((v) => !v.delivery && v.status === 'idle' && !depotCities.has(v.cityId) && !(v.movingUntil && v.movingUntil > now)).length : 0;
  // 1.1.3: what the rent costs on average per trip (last 10 trips), to compare with buying out.
  const rentRows = features.rent_vs_buy && fleet.vehicles.some((v) => v.rental) ? await db.select({ cents: ledgerEntries.amountCents }).from(ledgerEntries).where(and(eq(ledgerEntries.companyId, company.id), eq(ledgerEntries.category, 'rental'))).orderBy(desc(ledgerEntries.createdAt)).limit(10) : [];
  const avgRentCents = rentRows.length ? Math.round(rentRows.reduce((s, r) => s - Number(r.cents), 0) / rentRows.length) : 0;
  // 1.1.3: what the rent has cost so far, all trips together.
  const [{ total: rentTotal = 0 } = {}] = rentRows.length ? await db.select({ total: sql<number>`coalesce(-sum(${ledgerEntries.amountCents}), 0)::bigint` }).from(ledgerEntries).where(and(eq(ledgerEntries.companyId, company.id), eq(ledgerEntries.category, 'rental'))) : [];

  return (
    <div className="space-y-6">
      <PageHeader title={tr('Автопарк')} subtitle={tr('Твоите превозни средства, къде са и какво правят.')} actions={<Link href="/game/market" className="btn-primary"><Truck className="h-4 w-4" />{tr('Купи техника')}</Link>} />
      {features.road_choices && <RoadChoices db={db} companyId={company.id} now={now} />}
      <div className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
        <span className="flex items-center gap-2">
          <Warehouse className="h-4 w-4 text-prestige" />
          {myDepots.length
            ? <span>{tr('Депа: {0}', myDepots.map((d) => tx(d.name)).join(', '))}{' · '}<span className="num font-semibold">{tr('{0} / {1} места', capacity.used, capacity.slots)}</span></span>
            : <span>{tr('Нямаш депо — първото е безплатно, там купуваш и паркираш собствени камиони.')}</span>}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {features.depot_all && awayIdle > 1 && (
            <ActionButton action={{ type: 'moveAllToDepot' }} className="btn-ghost px-3 py-1.5 text-xs" confirm={tr('{0} празни камиона тръгват към най-близкото депо — пристигат до минута, безплатно. Продължаваш ли?', awayIdle)}>
              <Warehouse className="h-3.5 w-3.5" />{tr('Всички свободни в депото ({0})', awayIdle)}
            </ActionButton>
          )}
          <Link href="/game/logistics" className="btn-ghost px-3 py-1.5 text-xs">{myDepots.length ? tr('Депа') : tr('Открий депо')}</Link>
        </span>
      </div>
      {fleet.vehicles.length === 0 && <Empty icon={Truck} title={tr('Нямате превозни средства')}>{tr('Купете първото си превозно средство от пазара.')}</Empty>}
      <div className="grid gap-4 xl:grid-cols-2">
        {fleet.vehicles.map((v) => (
          <Card key={v.id} className="flex flex-col">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-lg font-bold">{tx(v.model.name)}</span>
                  <Badge>{tx(KIND[v.model.kind])}</Badge>
                  {v.ownership === 'rented' && <Badge tone="gold">{tr('Нает')}</Badge>}
                  {v.ownership === 'company' && <Badge tone="cyan">{tr('Фирмен')}</Badge>}
                  {features.legendary_trucks && legendTier(v.odometerKm) > 0 && <Badge tone="gold">🏆 {tx(LEGEND[legendTier(v.odometerKm) - 1]!.title)}</Badge>}
                  {leased.has(v.id) && <a href="/game/finance#leases"><Badge tone="violet">{tr('Лизинг {0}/{1}', leased.get(v.id)!.paid, leased.get(v.id)!.payments)}</Badge></a>}
                  {v.delivery ? <Badge tone="cyan">{tr('На курс')}</Badge> : v.status === 'listed' ? <Badge tone="gold">{tr('Обявен за продажба')}</Badge> : <Badge tone="green">{tr('Свободен')}</Badge>}
                </div>
                <div className="mt-0.5 font-mono text-xs text-mist-400">{v.nickname && <span className="font-sans font-semibold text-mist-200">„{v.nickname}“ · </span>}{tx(v.plate)} <CopyText text={v.plate} /> · {tx(v.model.brand)}</div>
              </div>
              <div className="text-right text-xs text-mist-400">
                <div className="flex items-center justify-end gap-1"><MapPin className="h-3.5 w-3.5" />{v.delivery ? `${tx(v.delivery.origin.nameBg)} → ${tx(v.delivery.destination.nameBg)}` : `${tx(v.city.nameBg)}, ${v.city.countryCode}`}</div>
                <div className="num mt-0.5">{tr('{0} км пробег', int(v.odometerKm))}</div>
              </div>
            </div>
            <div className="my-3 flex h-28 items-end justify-center rounded-xl bg-[linear-gradient(180deg,transparent_60%,rgba(255,255,255,0.04))] px-2">
              <VehicleIllustration modelId={v.modelId} trailerModelId={v.trailer?.modelId} color={v.color} livery={v.livery} cosmetics={v.cosmetics} trailerUpgrades={v.trailer?.upgrades} trailerLogo={v.trailer?.logo} trailerCosmetics={v.trailer?.cosmetics} martenitsa={marta} className="max-h-28 w-full" />
            </div>
            {v.delivery && (
              <div className="mb-3 rounded-xl border border-asphalt-700 bg-asphalt-850 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-semibold">{tr('{0} · {1} т', features.sealed_cargo && v.delivery.contract.sealed ? tr('📦 Запечатан товар') : v.delivery.contract.goods, dec(v.delivery.contract.weightTons))}</span>
                  <span className="num text-profit">{money(v.delivery.contract.rewardCents)}</span>
                </div>
                <DeliveryProgress schedule={v.delivery.schedule} etaAt={v.delivery.etaAt} deadlineAt={v.delivery.deadlineAt} ghost={(() => {
                  const g = ghosts.get(`${v.delivery.contract.originCityId}:${v.delivery.contract.destCityId}`);
                  return g ? { username: g.username, minutes: g.minutes, mine: g.userId === user.id } : null;
                })()} />
                {features.roadside_paid && (() => {
                  const stop = helpableStop(v.delivery.schedule, now.getTime());
                  return stop ? <RoadsideChoice deliveryId={v.delivery.id} note={stop.note ?? tr('Спрял по пътя')} /> : null;
                })()}
                <div className="mt-2 text-xs text-mist-400">{tr('{0}{1} с товар', v.delivery.emptyKm > 0 && tr('{0} празен курс + ', km(v.delivery.emptyKm)), km(v.delivery.loadedKm))}</div>
              </div>
            )}
            <dl className="mt-auto grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><dt className="label">{tr('Състояние')}</dt><dd className="num mt-1">{Math.round(v.condition)}%<Meter value={v.condition} className="mt-1" /></dd></div>
              <div><dt className="label">{tr('Капацитет')}</dt><dd className="num mt-1">{v.model.kind === 'tractor' && !v.trailer ? '—' : tr('{0} т', combinationCapability({ unit: v.model, trailer: v.trailer?.model ?? null }).payloadTons)}</dd></div>
              <div><dt className="label">{tr('Надстройка')}</dt><dd className="mt-1">{v.model.kind === 'tractor' ? (v.trailer ? tx(BODY_LABELS[v.trailer.model.body]) : <span className="text-amber-sig">{tr('без ремарке')}</span>) : `${tx(BODY_LABELS[v.model.body!])}${v.trailer ? tr(' + прикачно') : ''}`}</dd></div>
              <div><dt className="label">{tr('Шофьор')}</dt><dd className="mt-1 flex items-center gap-1">{v.driver ? <><UserRound className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{tx(v.driver.name)}{v.coDriver ? ` + ${v.coDriver.name}` : ''}</span></> : <span className="text-amber-sig">{tr('няма')}</span>}</dd></div>
            </dl>
            {(() => {
              // 1.1.3.2: an idle truck away from every depot goes home in a minute, for free, from any country.
              if (v.delivery || v.status !== 'idle') return null;
              if (v.movingUntil && v.movingUntil > now) return <p className="mt-3 text-xs text-cyan-glow">{tr('🏠 Пътува към депото — пристига до минута.')}</p>;
              if (myDepots.some((d) => d.cityId === v.cityId)) return null;
              const targets = myDepots.filter((d) => d.cityId !== v.cityId);
              if (!targets.length) return null;
              return (
                <div className="mt-3 rounded-xl border border-asphalt-700 px-3 py-2">
                  {targets.length === 1 ? (
                    <ActionButton action={{ type: 'moveToDepot', vehicleId: v.id, depotId: targets[0]!.id }} className="btn-ghost px-3 py-1.5 text-sm">
                      <Warehouse className="h-4 w-4" />{tr('Към депото в {0}', tx(targets[0]!.name))}
                    </ActionButton>
                  ) : (
                    <SelectAction label={tr('Към депото')} ariaLabel={tr('Депо за {0}', v.plate)} value="" options={[{ value: '', label: tr('— избери депо —') }, ...targets.map((d) => ({ value: d.id, label: tx(d.name) }))]} action={{ type: 'moveToDepot', vehicleId: v.id }} field="depotId" />
                  )}
                  <p className="mt-1 text-xs text-mist-400">{tr('Празен камион се връща в депото за 1 минута — безплатно, от всяка държава. Прикаченото ремарке идва с него.')}</p>
                </div>
              );
            })()}
            {!v.driver && !v.delivery && self && !selfBusy && (
              <div className="mt-3">
                <ActionButton action={{ type: 'assignDriver', driverId: self.id, vehicleId: v.id }} className="btn-ghost px-3 py-1.5 text-sm">
                  <UserRound className="h-4 w-4" />{tr('Карай този камион сам')}
                </ActionButton>
              </div>
            )}
            {vip && v.driver && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gold-400/30 bg-gold-400/5 px-3 py-2 text-xs">
                <span className="text-mist-300"><span className="font-semibold text-gold-400">{tr('VIP диспечер:')}</span>{' '}{tr('{0} (до {1} курса на ден)', v.autoDispatch ? tr('камионът сам поема следващия най-изгоден курс, щом е свободен') : tr('изключен'), AUTO_DISPATCH_PER_DAY)}</span>
                <ActionButton action={{ type: 'autoDispatch', vehicleId: v.id, on: !v.autoDispatch }} className="btn-ghost px-2.5 py-1 text-xs">{v.autoDispatch ? tr('Изключи') : tr('Включи')}</ActionButton>
                {v.autoDispatch && v.autoDispatchNote && !v.delivery && <p className="basis-full text-amber-sig">{tr('Сега не изпраща: {0}', tr(v.autoDispatchNote))}</p>}
              </div>
            )}
            {v.rental && (
              <div className="mt-3 space-y-2 rounded-xl border border-gold-400/30 bg-gold-400/5 px-3 py-2 text-xs text-mist-300">
                <p>{tr('Нает камион: {0}% от възнаграждението за курса + {1} лв./км; без разходи за гориво, такси и сервиз.', Math.round(ECONOMY.rentalShare * 100), (ECONOMY.rentalCentsPerKm / 100).toFixed(2))}</p>
                {v.returnPending ? (
                  <p className="font-semibold text-amber-sig">{tr('Вече имаш собствен камион — този ще бъде върнат на наемодателя, щом приключи курса.')}</p>
                ) : (
                  <>
                    <p>{tr('Когато купиш собствен камион, наетият се връща автоматично.')}</p>
                    {v.rental.trips >= RENTAL_BUYOUT_DELIVERIES ? (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>{tr('Наемодателят ти предлага да го откупиш за')}{' '}<span className="num font-bold text-gold-400">{money(v.rental.buyoutCents)}</span> <span className="text-mist-400">{tr('(нов: {0})', money(v.model.priceCents))}</span>.</span>
                        {features.rent_vs_buy && avgRentCents > 0 && <span className="basis-full text-mist-300">{tr('Наемът ти струва средно {0} на курс — откупуването се изплаща за около {1} курса. После печелиш целия курс, но плащаш гориво, такси и сервиз.', money(avgRentCents), Math.ceil(v.rental.buyoutCents / avgRentCents))}</span>}
                        {features.rent_vs_buy && Number(rentTotal) > 0 && <span className="basis-full text-mist-400">{tr('Досега си платил за наем общо {0}.', money(Number(rentTotal)))}</span>}
                        <ActionButton action={{ type: 'buyoutRental', vehicleId: v.id }} className="btn-gold px-3 py-1.5 text-xs" disabled={company.balanceCents < v.rental.buyoutCents} confirm={tr('Да откупим ли {0} ({1}) за {2}?', v.model.name, v.plate, money(v.rental.buyoutCents))}>
                          <BadgeEuro className="h-3.5 w-3.5" />{tr('Откупи')}
                        </ActionButton>
                      </div>
                    ) : (
                      <div>
                        <div className="flex justify-between"><span>{tr('До предложение за откупуване')}</span><span className="num">{tr('{0} / {1} доставки', v.rental.trips, RENTAL_BUYOUT_DELIVERIES)}</span></div>
                        <Meter value={(v.rental.trips / RENTAL_BUYOUT_DELIVERIES) * 100} tone="gold" className="mt-1" />
                      </div>
                    )}
                  </>
                )}
                {fleet.vehicles.length > 1 && !v.delivery && !v.driver?.isOwner && !v.returnPending && (
                  <ActionButton action={{ type: 'returnRental', vehicleId: v.id }} className="btn-ghost px-3 py-1.5 text-xs" confirm={tr('Да върнем ли камиона на наемодателя?')}>{tr('Върни')}</ActionButton>
                )}
              </div>
            )}
            {(v.upgrades.length > 0 || v.hiddenCompartment) && (
              <div className="mt-3 flex flex-wrap gap-1.5">{v.upgrades.map((u) => <Badge key={u} tone="violet">{tx(UPGRADES[u as UpgradeId]?.label ?? u)}</Badge>)}{v.hiddenCompartment && <Badge tone="violet">{tr('🕳️ Тайно отделение')}</Badge>}</div>
            )}
          </Card>
        ))}
      </div>

      {loose.length > 0 && (
        <Card title={tr('Свободни ремаркета')}>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {loose.map((t) => (
              <li key={t.id} className="rounded-xl border border-asphalt-700 bg-asphalt-850 p-3">
                <TrailerIllustration modelId={t.modelId} className="h-16 w-full" />
                <div className="mt-2 flex items-center justify-between text-sm"><span className="font-semibold">{tx(t.model.name)}</span><span className="text-xs text-mist-400">{tx(t.city.nameBg)}</span></div>
                <div className="mt-1 flex items-center gap-2 text-xs text-mist-400"><Gauge className="h-3.5 w-3.5" />{tr('{0}% · {1} т · {2}', Math.round(t.condition), t.model.payloadTons, t.plate)}</div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

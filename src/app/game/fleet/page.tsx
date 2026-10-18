import { BadgeEuro, Gauge, MapPin, Truck, UserRound, Wrench } from 'lucide-react';
import Link from 'next/link';
import { DeliveryProgress } from '@/components/game/DeliveryProgress';
import { Badge, Card, Empty, Meter, PageHeader } from '@/components/ui';
import { TrailerIllustration, VehicleIllustration } from '@/components/vehicles/VehicleIllustration';
import { dec, int, km, money } from '@/lib/format';
import { BODY_LABELS } from '@/server/game/deliveries';
import { gameContext } from '@/server/game/context';
import { fleetView } from '@/server/game/queries';
import { RENTAL_BUYOUT_DELIVERIES, UPGRADES, combinationCapability, type UpgradeId } from '@/lib/game/catalog';
import { ActionButton } from '@/components/ui/ActionButton';
import { ECONOMY } from '@/lib/game/economy';

export const metadata = { title: 'Автопарк' };

const KIND = { van: 'Ван', rigid: 'Соло камион', tractor: 'Влекач' } as const;

export default async function FleetPage() {
  const { db, company } = await gameContext();
  const fleet = await fleetView(db, company.id);
  const loose = fleet.trailers.filter((t) => !t.vehicleId);
  // The player drives one truck themselves and can switch to another idle one.
  const self = fleet.drivers.find((d) => d.isOwner);
  const selfBusy = !!self?.vehicleId && fleet.vehicles.some((x) => x.id === self.vehicleId && x.status !== 'idle');

  return (
    <div className="space-y-6">
      <PageHeader title="Автопарк" subtitle="Твоите превозни средства, къде са и какво правят." actions={<Link href="/game/market" className="btn-primary"><Truck className="h-4 w-4" />Купи техника</Link>} />
      {fleet.vehicles.length === 0 && <Empty icon={Truck} title="Нямате превозни средства">Купете първото си превозно средство от пазара.</Empty>}
      <div className="grid gap-4 xl:grid-cols-2">
        {fleet.vehicles.map((v) => (
          <Card key={v.id} className="flex flex-col">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-lg font-bold">{v.model.name}</span>
                  <Badge>{KIND[v.model.kind]}</Badge>
                  {v.ownership === 'rented' && <Badge tone="gold">Нает</Badge>}
                  {v.delivery ? <Badge tone="cyan">На курс</Badge> : v.status === 'listed' ? <Badge tone="gold">Обявен за продажба</Badge> : <Badge tone="green">Свободен</Badge>}
                </div>
                <div className="mt-0.5 font-mono text-xs text-mist-400">{v.plate} · {v.model.brand}</div>
              </div>
              <div className="text-right text-xs text-mist-400">
                <div className="flex items-center justify-end gap-1"><MapPin className="h-3.5 w-3.5" />{v.delivery ? `${v.delivery.origin.nameBg} → ${v.delivery.destination.nameBg}` : `${v.city.nameBg}, ${v.city.countryCode}`}</div>
                <div className="num mt-0.5">{int(v.odometerKm)} км пробег</div>
              </div>
            </div>
            <div className="my-3 flex h-28 items-end justify-center rounded-xl bg-[linear-gradient(180deg,transparent_60%,rgba(255,255,255,0.04))] px-2">
              <VehicleIllustration modelId={v.modelId} trailerModelId={v.trailer?.modelId} color={v.color} livery={v.livery} className="max-h-28 w-full" />
            </div>
            {v.delivery && (
              <div className="mb-3 rounded-xl border border-asphalt-700 bg-asphalt-850 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-semibold">{v.delivery.contract.goods} · {dec(v.delivery.contract.weightTons)} т</span>
                  <span className="num text-profit">{money(v.delivery.contract.rewardCents)}</span>
                </div>
                <DeliveryProgress schedule={v.delivery.schedule} etaAt={v.delivery.etaAt} deadlineAt={v.delivery.deadlineAt} />
                <div className="mt-2 text-xs text-mist-400">{v.delivery.emptyKm > 0 && `${km(v.delivery.emptyKm)} празен курс + `}{km(v.delivery.loadedKm)} с товар</div>
              </div>
            )}
            <dl className="mt-auto grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><dt className="label">Състояние</dt><dd className="num mt-1">{Math.round(v.condition)}%<Meter value={v.condition} className="mt-1" /></dd></div>
              <div><dt className="label">Капацитет</dt><dd className="num mt-1">{v.model.kind === 'tractor' && !v.trailer ? '—' : `${combinationCapability({ unit: v.model, trailer: v.trailer?.model ?? null }).payloadTons} т`}</dd></div>
              <div><dt className="label">Надстройка</dt><dd className="mt-1">{v.model.kind === 'tractor' ? (v.trailer ? BODY_LABELS[v.trailer.model.body] : <span className="text-amber-sig">без ремарке</span>) : `${BODY_LABELS[v.model.body!]}${v.trailer ? ' + прикачно' : ''}`}</dd></div>
              <div><dt className="label">Шофьор</dt><dd className="mt-1 flex items-center gap-1">{v.driver ? <><UserRound className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{v.driver.name}{v.coDriver ? ` + ${v.coDriver.name}` : ''}</span></> : <span className="text-amber-sig">няма</span>}</dd></div>
            </dl>
            {!v.driver && !v.delivery && self && !selfBusy && (
              <div className="mt-3">
                <ActionButton action={{ type: 'assignDriver', driverId: self.id, vehicleId: v.id }} className="btn-ghost px-3 py-1.5 text-sm">
                  <UserRound className="h-4 w-4" />Карай този камион сам
                </ActionButton>
              </div>
            )}
            {v.rental && (
              <div className="mt-3 space-y-2 rounded-xl border border-gold-400/30 bg-gold-400/5 px-3 py-2 text-xs text-mist-300">
                <p>Нает камион: {Math.round(ECONOMY.rentalShare * 100)}% от възнаграждението за курса + {(ECONOMY.rentalCentsPerKm / 100).toFixed(2)} €/км; без разходи за гориво, такси и сервиз.</p>
                {v.returnPending ? (
                  <p className="font-semibold text-amber-sig">Вече имаш собствен камион — този ще бъде върнат на наемодателя, щом приключи курса.</p>
                ) : (
                  <>
                    <p>Когато купиш собствен камион, наетият се връща автоматично.</p>
                    {v.rental.trips >= RENTAL_BUYOUT_DELIVERIES ? (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>Наемодателят ти предлага да го откупиш за <span className="num font-bold text-gold-400">{money(v.rental.buyoutCents)}</span> <span className="text-mist-400">(нов: {money(v.model.priceCents)})</span>.</span>
                        <ActionButton action={{ type: 'buyoutRental', vehicleId: v.id }} className="btn-gold px-3 py-1.5 text-xs" disabled={company.balanceCents < v.rental.buyoutCents} confirm={`Да откупим ли ${v.model.name} (${v.plate}) за ${money(v.rental.buyoutCents)}?`}>
                          <BadgeEuro className="h-3.5 w-3.5" />Откупи
                        </ActionButton>
                      </div>
                    ) : (
                      <div>
                        <div className="flex justify-between"><span>До предложение за откупуване</span><span className="num">{v.rental.trips} / {RENTAL_BUYOUT_DELIVERIES} доставки</span></div>
                        <Meter value={(v.rental.trips / RENTAL_BUYOUT_DELIVERIES) * 100} tone="gold" className="mt-1" />
                      </div>
                    )}
                  </>
                )}
                {fleet.vehicles.length > 1 && !v.delivery && !v.driver?.isOwner && !v.returnPending && (
                  <ActionButton action={{ type: 'returnRental', vehicleId: v.id }} className="btn-ghost px-3 py-1.5 text-xs" confirm="Да върнем ли камиона на наемодателя?">Върни</ActionButton>
                )}
              </div>
            )}
            {v.upgrades.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">{v.upgrades.map((u) => <Badge key={u} tone="violet">{UPGRADES[u as UpgradeId]?.label ?? u}</Badge>)}</div>
            )}
          </Card>
        ))}
      </div>

      {loose.length > 0 && (
        <Card title="Свободни ремаркета">
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {loose.map((t) => (
              <li key={t.id} className="rounded-xl border border-asphalt-700 bg-asphalt-850 p-3">
                <TrailerIllustration modelId={t.modelId} className="h-16 w-full" />
                <div className="mt-2 flex items-center justify-between text-sm"><span className="font-semibold">{t.model.name}</span><span className="text-xs text-mist-400">{t.city.nameBg}</span></div>
                <div className="mt-1 flex items-center gap-2 text-xs text-mist-400"><Gauge className="h-3.5 w-3.5" />{Math.round(t.condition)}% · {t.model.payloadTons} т · {t.plate}</div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

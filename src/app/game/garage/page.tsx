import { Wrench } from 'lucide-react';
import { Badge, Card, Empty, Meter, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { SelectAction } from '@/components/ui/SelectAction';
import { TrailerIllustration, VehicleIllustration } from '@/components/vehicles/VehicleIllustration';
import { dateTime, money } from '@/lib/format';
import { USED_MARKET } from '@/lib/game/used-market';
import { ListForSale } from '@/components/game/ListForSale';
import { boundsFor, myListings } from '@/server/game/used-market';
import { TRAILERS, UPGRADES, canCouple } from '@/lib/game/catalog';
import { repairCostCents } from '@/lib/game/economy';
import { isVip, VIP_PERKS } from '@/lib/game/vip';
import { gameContext } from '@/server/game/context';
import { fleetView } from '@/server/game/queries';

export const metadata = { title: 'Сервиз' };

export default async function GaragePage() {
  const { db, user, company, now } = await gameContext();
  // VIP: discount on repairs and upgrades.
  const discount = isVip(user.vipUntil, now) ? 1 - VIP_PERKS.garageDiscount : 1;
  const [fleet, listings] = await Promise.all([fleetView(db, company.id), myListings(db, company.id)]);
  const listingOf = (id: string) => listings.find((l) => l.vehicleId === id || l.trailerId === id);

  return (
    <div className="space-y-6">
      <PageHeader title="Сервиз" subtitle="Ремонти, подобрения, ремаркета и продажба — между курсовете."
        help="Продажбата веднага става на търговец. Ако обявиш техниката на пазара, друг играч може да я купи на твоята цена (такса 5%); докато е обявена, не кара. Обявата изтича след 7 дни." />
      {fleet.vehicles.length === 0 && <Empty icon={Wrench} title="Няма техника за сервиз" />}
      <div className="space-y-4">
        {fleet.vehicles.map((v) => {
          const listing = listingOf(v.id);
          const busy = !!v.delivery || !!listing;
          const repair = Math.round((repairCostCents(v.model.priceCents, v.condition) + (v.trailer ? repairCostCents(v.trailer.model.priceCents, v.trailer.condition) : 0)) * discount);
          const trailerOptions = fleet.trailers.filter((t) => t.cityId === v.cityId && canCouple(v.model, t.model));
          return (
            <Card key={v.id}>
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-lg font-bold">{v.model.name}</span>
                    <span className="font-mono text-xs text-mist-400">{v.plate}</span>
                    {listing ? <Badge tone="gold">обявено · {money(listing.priceCents)}</Badge> : v.delivery ? <Badge tone="cyan">на курс</Badge> : <Badge tone="green">в {v.city.nameBg}</Badge>}
                  </div>
                  <VehicleIllustration modelId={v.modelId} trailerModelId={v.trailer?.modelId} color={v.color} className="my-3 h-24 w-full" />
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
                </div>
                {v.ownership === 'rented' ? (
                  <div className="space-y-3 text-sm text-mist-300">
                    <Badge tone="gold">Нает</Badge>
                    <p>Поддръжката, ремонтите и горивото са за сметка на наемодателя. Наетите превозни средства не се модифицират и не се продават.</p>
                    {!busy && !v.driver?.isOwner && <ActionButton action={{ type: 'returnRental', vehicleId: v.id }} className="btn-ghost" confirm="Да върнем ли камиона?">Върни на наемодателя</ActionButton>}
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
                        .filter((u) => u.appliesTo.includes(v.model.kind))
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
                  <TrailerIllustration modelId={t.modelId} className="h-14 w-full" />
                  <div className="mt-2 flex items-center justify-between"><span className="font-semibold">{t.model.name}</span><span className="font-mono text-xs text-mist-400">{t.plate}</span></div>
                  <div className="mt-1 text-xs text-mist-400">{tractor ? `Прикачено към ${tractor.plate}` : `Паркирано в ${t.city.nameBg}`} · {Math.round(t.condition)}%</div>
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
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}

import { Store, Warehouse } from 'lucide-react';
import Link from 'next/link';
import { BuyGoodsForm, ShipGoodsForm, type DeskVehicle } from '@/components/game/TradeDesk';
import { Badge, Card, Empty, Meter, PageHeader } from '@/components/ui';
import { dateTime, money } from '@/lib/format';
import { CARGO, type CargoType } from '@/lib/game/cargo';
import { combinationCapability } from '@/lib/game/catalog';
import { gameContext } from '@/server/game/context';
import { ActionButton } from '@/components/ui/ActionButton';
import { fleetView } from '@/server/game/queries';
import { bestBuyers, myFreight, tradeOverview } from '@/server/game/trade';

export const metadata = { title: 'Търговия със стоки' };

export default async function TradePage({ searchParams }: { searchParams: Promise<{ rate?: string }> }) {
  const { db, user, company, now, features } = await gameContext();
  const { rate } = await searchParams;
  const exchange = features.freight_exchange ? await myFreight(db, company.id, user.id) : null;
  const [overview, fleet] = await Promise.all([tradeOverview(db, company.id, now), fleetView(db, company.id)]);
  const labels = Object.fromEntries(Object.values(CARGO).map((c) => [c.id, c.label]));
  const vehicles: DeskVehicle[] = fleet.vehicles
    .filter((v) => !v.delivery && v.status === 'idle' && v.driver)
    .map((v) => {
      const cap = combinationCapability({ unit: v.model, trailer: v.trailer?.model ?? null });
      return { id: v.id, label: `${v.plate} · ${v.model.name} · ${v.city.nameBg} · ${cap.payloadTons} т`, cityId: v.cityId, bodies: cap.bodies, payloadTons: cap.payloadTons };
    });
  // Where each cargo in stock sells best, seen from its warehouse.
  const buyers = Object.fromEntries(
    await Promise.all(overview.flatMap((d) => d.stock.map(async (s) => [`${d.id}:${s.cargo}`, await bestBuyers(db, d.cityId, s.cargo, now)] as const))),
  );
  const depotList = overview.map((d) => ({ cityId: d.cityId, name: d.name, free: d.capacityTons - d.usedTons }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Търговия със стоки"
        subtitle="Купи евтино където се произвежда, превози сам и продай скъпо където се търси."
        help="Всяко твое депо има склад (15 т на място в депото). Купуваш стоки от производителите в града на депото, а после ги превозваш със свой камион: за продажба в град, който ги търси, или в друго твое депо. Цените са игрови данни. Зависят от държавата (в Германия и Австрия стоките са по-скъпи, отколкото в България), от търсенето в града и се менят всеки ден с до ±12%, така че избери кога и къде да продадеш. Продажбата става по цената в деня на пристигане и намалява търсенето там. Разходите за курса (гориво, такси) са като при поръчка, но няма възнаграждение — печалбата е разликата в цената."
      />
      {exchange && (exchange.toRate.length > 0 || exchange.offers.length > 0) && (
        <Card title="Борса между играчите">
          {exchange.toRate.length > 0 && (
            <ul className="mb-3 space-y-2 text-sm">
              {exchange.toRate.map((r) => (
                <li key={r.contractId} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2 ${rate === r.contractId ? 'border-gold-400/60 bg-gold-400/10' : 'border-asphalt-700'}`}>
                  <span><b>{r.hauler}</b> превози {r.goods} — оцени го:</span>
                  <span className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <ActionButton key={n} action={{ type: 'rateHauler', contractId: r.contractId, stars: n }} className="btn-ghost px-2 py-1 text-xs">{'★'.repeat(n)}</ActionButton>)}</span>
                </li>
              ))}
            </ul>
          )}
          {exchange.offers.length > 0 && (
            <ul className="divide-y divide-asphalt-800 text-sm">
              {exchange.offers.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{o.weightTons} т {o.goods} · {money(o.rewardCents)}</span>
                  <Badge tone={o.status === 'open' ? 'gold' : 'cyan'}>{o.status === 'open' ? `чака превозвач до ${dateTime(o.expiresAt)}` : 'на път'}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {overview.length === 0 ? (
        <Card><Empty icon={Warehouse} title="Нямаш депо">Складовете са в депата. <Link href="/game/logistics" className="text-cyan-glow underline">Открий депо</Link> и започни да търгуваш.</Empty></Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {overview.map((d) => (
            <Card key={d.id} title={<span className="inline-flex items-center gap-2"><Warehouse className="h-4 w-4 text-prestige" />Склад {d.name} <span className="text-xs font-normal text-mist-400">{d.countryCode}</span></span>} actions={<span className="num text-xs text-mist-400">{d.usedTons} / {d.capacityTons} т</span>}>
              <Meter value={(d.usedTons / d.capacityTons) * 100} tone="cyan" />
              <div className="mt-4">
                <h3 className="label mb-2">В склада</h3>
                {d.stock.length === 0 ? (
                  <p className="text-sm text-mist-400">Празен. Купи стока по-долу.</p>
                ) : (
                  <ul className="space-y-3">
                    {d.stock.map((s) => (
                      <li key={s.cargo} className="rounded-xl border border-asphalt-700 bg-asphalt-850/60 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span><span className="font-semibold">{labels[s.cargo]}</span> · <span className="num">{s.tons} т</span></span>
                          <span className="text-xs text-mist-400">средно {money(s.avgCents)}/т · общо {money(s.costCents)}</span>
                        </div>
                        <div className="mt-2">
                          <ShipGoodsForm depotId={d.id} depotCityId={d.cityId} row={s} label={labels[s.cargo]!} bodies={CARGO[s.cargo as CargoType].bodies} vehicles={vehicles} buyers={buyers[`${d.id}:${s.cargo}`] ?? []} depots={depotList} exchange={features.freight_exchange} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="mt-5 border-t border-asphalt-800 pt-4">
                <h3 className="label mb-2 flex items-center gap-1.5"><Store className="h-3.5 w-3.5" />Купи от производители в {d.name}</h3>
                <BuyGoodsForm depotId={d.id} offers={d.buy} freeTons={d.capacityTons - d.usedTons} labels={labels} balanceCents={company.balanceCents} />
              </div>
              {d.sell.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5 text-xs">
                  <span className="text-mist-400">Тук купуват:</span>
                  {d.sell.map((s) => <Badge key={s.cargo} tone="green">{labels[s.cargo]} · {money(s.priceCents)}/т</Badge>)}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

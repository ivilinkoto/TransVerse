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
import { CLEARANCE } from '@/lib/game/trade';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Търговия със стоки') };
}

export default async function TradePage({ searchParams }: { searchParams: Promise<{ rate?: string }> }) {
  await initLocale();
  const { db, user, company, now, features } = await gameContext();
  const { rate } = await searchParams;
  const exchange = features.freight_exchange ? await myFreight(db, company.id, user.id) : null;
  const [overview, fleet] = await Promise.all([tradeOverview(db, company.id, now), fleetView(db, company.id)]);
  const labels = Object.fromEntries(Object.values(CARGO).map((c) => [c.id, c.label]));
  const vehicles: DeskVehicle[] = fleet.vehicles
    .filter((v) => !v.delivery && v.status === 'idle' && v.driver)
    .map((v) => {
      const cap = combinationCapability({ unit: v.model, trailer: v.trailer?.model ?? null });
      return { id: v.id, label: t('{0} · {1} · {2} · {3} т', v.plate, v.model.name, v.city.nameBg, cap.payloadTons), cityId: v.cityId, bodies: cap.bodies, payloadTons: cap.payloadTons };
    });
  // Where each cargo in stock sells best, seen from its warehouse.
  const buyers = Object.fromEntries(
    await Promise.all(overview.flatMap((d) => d.stock.map(async (s) => [`${d.id}:${s.cargo}`, await bestBuyers(db, d.cityId, s.cargo, now)] as const))),
  );
  const depotList = overview.map((d) => ({ cityId: d.cityId, name: d.name, free: d.capacityTons - d.usedTons }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('Търговия със стоки')}
        subtitle={t('Купи евтино където се произвежда, превози сам и продай скъпо където се търси.')}
        help={t('Всяко твое депо има склад (15 т на място в депото). Купуваш стоки от производителите в града на депото, а после ги превозваш със свой камион: за продажба в град, който ги търси, или в друго твое депо. Цените са игрови данни. Зависят от държавата (в Германия и Австрия стоките са по-скъпи, отколкото в България), от търсенето в града и се менят всеки ден с до ±12%, така че избери кога и къде да продадеш. Продажбата става по цената в деня на пристигане и намалява търсенето там. Разходите за курса (гориво, такси) са като при поръчка, но няма възнаграждение — печалбата е разликата в цената.')}
      />
      {exchange && (exchange.toRate.length > 0 || exchange.offers.length > 0) && (
        <Card title={t('Борса между играчите')}>
          {exchange.toRate.length > 0 && (
            <ul className="mb-3 space-y-2 text-sm">
              {exchange.toRate.map((r) => (
                <li key={r.contractId} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2 ${rate === r.contractId ? 'border-gold-400/60 bg-gold-400/10' : 'border-asphalt-700'}`}>
                  <span><b>{tx(r.hauler)}</b>{' '}{t('превози {0} — оцени го:', r.goods)}</span>
                  <span className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <ActionButton key={n} action={{ type: 'rateHauler', contractId: r.contractId, stars: n }} className="btn-ghost px-2 py-1 text-xs">{'★'.repeat(n)}</ActionButton>)}</span>
                </li>
              ))}
            </ul>
          )}
          {exchange.offers.length > 0 && (
            <ul className="divide-y divide-asphalt-800 text-sm">
              {exchange.offers.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{t('{0} т {1} · {2}', o.weightTons, o.goods, money(o.rewardCents))}</span>
                  <Badge tone={o.status === 'open' ? 'gold' : 'cyan'}>{o.status === 'open' ? t('чака превозвач до {0}', dateTime(o.expiresAt)) : t('на път')}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {overview.length === 0 ? (
        <Card><Empty icon={Warehouse} title={t('Нямаш депо')}>{t('Складовете са в депата.')}{' '}<Link href="/game/logistics" className="text-cyan-glow underline">{t('Открий депо')}</Link>{' '}{t('и започни да търгуваш.')}</Empty></Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {overview.map((d) => (
            <Card key={d.id} title={<span className="inline-flex items-center gap-2"><Warehouse className="h-4 w-4 text-prestige" />{t('Склад {0}', d.name)}{' '}<span className="text-xs font-normal text-mist-400">{tx(d.countryCode)}</span></span>} actions={<span className="num text-xs text-mist-400">{t('{0} / {1} т', d.usedTons, d.capacityTons)}</span>}>
              <Meter value={(d.usedTons / d.capacityTons) * 100} tone="cyan" />
              <div className="mt-4">
                <h3 className="label mb-2">{t('В склада')}</h3>
                {d.stock.length === 0 ? (
                  <p className="text-sm text-mist-400">{t('Празен. Купи стока по-долу.')}</p>
                ) : (
                  <ul className="space-y-3">
                    {d.stock.map((s) => (
                      <li key={s.cargo} className="rounded-xl border border-asphalt-700 bg-asphalt-850/60 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span><span className="font-semibold">{tx(labels[s.cargo])}</span> · <span className="num">{t('{0} т', s.tons)}</span></span>
                          <span className="text-xs text-mist-400">{t('средно {0}/т · общо {1}', money(s.avgCents), money(s.costCents))}</span>
                        </div>
                        {features.warehouse_clearance && s.clearable && (
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-asphalt-900/60 px-2 py-1.5 text-xs">
                            <span className="text-mist-300">{t('Стои тук от поне {0} дни — разчисти мястото за {1} ({2} % от цената ѝ).', CLEARANCE.minDays, money(s.clearCents), Math.round(CLEARANCE.share * 100))}</span>
                            <ActionButton action={{ type: 'clearStock', depotId: d.id, cargo: s.cargo }} className="btn-ghost px-2 py-1 text-xs" confirm={t('Да продадем ли {0} т за {1}?', s.tons, money(s.clearCents))}>{t('Разчисти')}</ActionButton>
                          </div>
                        )}
                        <div className="mt-2">
                          <ShipGoodsForm depotId={d.id} depotCityId={d.cityId} row={s} label={labels[s.cargo]!} bodies={CARGO[s.cargo as CargoType].bodies} vehicles={vehicles} buyers={buyers[`${d.id}:${s.cargo}`] ?? []} depots={depotList} exchange={features.freight_exchange} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="mt-5 border-t border-asphalt-800 pt-4">
                <h3 className="label mb-2 flex items-center gap-1.5"><Store className="h-3.5 w-3.5" />{t('Купи от производители в {0}', d.name)}</h3>
                <BuyGoodsForm depotId={d.id} offers={d.buy} freeTons={d.capacityTons - d.usedTons} labels={labels} balanceCents={company.balanceCents} />
              </div>
              {d.sell.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5 text-xs">
                  <span className="text-mist-400">{t('Тук купуват:')}</span>
                  {d.sell.map((s) => <Badge key={s.cargo} tone="green">{t('{0} · {1}/т', labels[s.cargo], money(s.priceCents))}</Badge>)}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

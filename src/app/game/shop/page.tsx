import { and, eq, isNull, sql } from 'drizzle-orm';
import { CheckCircle2, Clock, Coins, Crown, History } from 'lucide-react';
import { ShopBuy, type VehicleOption } from '@/components/shop/ShopBuy';
import { Badge, Card, PageHeader } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { isFreightHub } from '@/lib/game/markets';
import { SHOP_CATEGORIES, SHOP_ITEMS, type ShopCategory } from '@/lib/game/shop';
import { HALLOWEEN, isHalloween } from '@/lib/game/halloween';
import { CHRISTMAS, isChristmas } from '@/lib/game/christmas';
import { VehicleIllustration } from '@/components/vehicles/VehicleIllustration';
import { isVip, STANDARD_COLORS, VIP_BENEFITS, VIP_COLORS } from '@/lib/game/vip';
import { cities, trailers, vehicles } from '@/server/db/schema';
import { coinHistory, COIN_REASON_LABELS, type CoinReason } from '@/server/game/coins';
import { gameContext } from '@/server/game/context';
import { BuyWithMoney } from '@/components/game/BuyWithMoney';
import { euro, paidProduct, PAID_PRODUCTS, PAYMENT_STATUS_LABELS } from '@/lib/game/payments';
import { paymentConfig, userPayments } from '@/server/payments';
import { trailerModel } from '@/lib/game/catalog';

export const metadata = { title: 'Магазин' };

export default async function ShopPage({ searchParams }: { searchParams: Promise<{ payment?: string }> }) {
  const cancelled = (await searchParams).payment === 'cancelled';
  const payment = paymentConfig();
  const { db, user, company, now, features } = await gameContext();
  const vip = isVip(user.vipUntil, now);
  const [fleet, cityRows, history, purchases] = await Promise.all([
    db
      .select({ id: vehicles.id, plate: vehicles.plate, modelId: vehicles.modelId, ownership: vehicles.ownership, status: vehicles.status, city: cities.nameBg })
      .from(vehicles)
      .innerJoin(cities, eq(cities.id, vehicles.cityId))
      .where(and(eq(vehicles.companyId, company.id), isNull(vehicles.soldAt))),
    db.select({ id: cities.id, name: cities.nameBg, country: cities.countryCode, population: cities.population }).from(cities).orderBy(cities.countryCode, sql`${cities.population} desc`),
    coinHistory(db, user.id, 20),
    userPayments(db, user.id, 8),
  ]);
  const trailerOptions = (await db.select({ id: trailers.id, plate: trailers.plate, modelId: trailers.modelId }).from(trailers).where(and(eq(trailers.companyId, company.id), eq(trailers.ownership, 'owned'), isNull(trailers.soldAt)))).map((t) => ({ id: t.id, label: `${t.plate} · ${trailerModel(t.modelId).name}` }));
  const vehicleOptions: VehicleOption[] = fleet.map((v) => ({ id: v.id, label: `${v.plate} · ${v.city}${v.ownership === 'rented' ? ' (нает)' : ''}${v.status !== 'idle' ? ' · на курс' : ''}`, owned: v.ownership === 'owned', idle: v.status === 'idle' }));
  const hubs = cityRows.filter((c) => isFreightHub({ population: c.population, country: c.country })).map((c) => ({ id: c.id, name: `${c.name} (${c.country})` }));
  const boostActive = user.xpBoostUntil && user.xpBoostUntil > now;
  const categories = (Object.keys(SHOP_CATEGORIES) as ShopCategory[]).filter((c) => c !== 'vip');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Магазин"
        subtitle="VIP, удобства и стил за твоята компания."
        help="ТрансКоин (TC) е премиум валутата на TransVerse. С нея се купуват VIP, удобства и козметика — никога игрови пари, за да е честно за всички."
        actions={<span className="flex items-center gap-2 rounded-xl border border-cyan-glow/30 bg-cyan-glow/10 px-4 py-2"><Coins className="h-5 w-5 text-cyan-glow" /><span className="num font-display text-xl font-bold text-cyan-glow">{user.coins.toLocaleString('bg-BG')} TC</span></span>}
      />

      <Card title={<span className="inline-flex items-center gap-2"><Crown className="h-4 w-4 text-gold-400" />VIP</span>} actions={vip ? <Badge tone="gold">Активен до {user.vipUntil!.toLocaleDateString('bg-BG')}</Badge> : <Badge>Нямаш VIP</Badge>}>
        <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          <div className="grid gap-4 sm:grid-cols-2">
            {VIP_BENEFITS.map((b) => (
              <div key={b.group}>
                <div className="label mb-1.5">{b.group}</div>
                <ul className="space-y-1 text-sm">
                  {b.items.map((i) => <li key={i} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-gold-400" />{i}</li>)}
                </ul>
              </div>
            ))}
            <p className="text-xs text-mist-400 sm:col-span-2">VIP не дава сезонни точки и не влияе на класациите — предимствата са умерени, за да е честно за всички.</p>
          </div>
          <div className="space-y-3">
            {SHOP_ITEMS.filter((i) => i.category === 'vip').map((i) => (
              <div key={i.id} className="rounded-xl border border-gold-400/30 bg-gold-400/5 p-3">
                <div className="flex items-center justify-between gap-2"><span className="font-semibold">{i.label}</span><span className="num font-bold text-cyan-glow">{i.price} TC</span></div>
                <p className="mb-2 mt-1 text-xs text-mist-400">{i.description}</p>
                <ShopBuy item={i} balance={user.coins} vip={vip} vehicles={vehicleOptions} cities={hubs} colors={STANDARD_COLORS} vipColors={VIP_COLORS} />
              </div>
            ))}
          </div>
        </div>
      </Card>

      {categories.map((cat) => (
        <section key={cat}>
          <h2 className="mb-3 font-display text-lg font-bold">{SHOP_CATEGORIES[cat]}</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {SHOP_ITEMS.filter((i) => i.category === cat && (!i.seasonal || (i.seasonal === 'halloween' ? isHalloween(now) : isChristmas(now))) && (!i.id.startsWith('paint_retro') || features.retro_collection) && (i.id !== 'truck_part' || features.cosmetics) && (i.id !== 'trailer_part' || features.trailer_cosmetics)).map((i) => (
              <Card key={i.id} className="flex flex-col">
                {i.id === 'paint_christmas' && <VehicleIllustration modelId="danubia-t440" trailerModelId="curtain-13" color={CHRISTMAS.paintColor} livery="christmas" className="mb-3 h-16 w-full" />}
                {i.id === 'trailer_part' && <VehicleIllustration modelId="danubia-t440" trailerModelId="curtain-13" color="#111827" trailerCosmetics={{ paint: '#111827', stripe: 'gold', flaps: 'chrome', toplights: 'amber' }} className="mb-3 h-16 w-full" />}
                {i.id === 'truck_part' && <VehicleIllustration modelId="danubia-t440" color="#1d4ed8" cosmetics={{ grille: 'chrome', lights: 'amber', visor: 'body', sticker: 'TRANSVERSE' }} className="mb-3 h-16 w-full" />}
                {i.id === 'paint_pumpkin' && <VehicleIllustration modelId="danubia-t440" trailerModelId="curtain-13" color={HALLOWEEN.pumpkinColor} livery="pumpkin" className="mb-3 h-16 w-full" />}
                <div className="flex items-start justify-between gap-2">
                  <div className="font-display font-bold">{i.label}</div>
                  <span className="num shrink-0 font-bold text-cyan-glow">{i.id === 'truck_part' || i.id === 'trailer_part' ? 'от ' : ''}{i.id === 'paint' && vip ? '0' : i.price} TC</span>
                </div>
                <p className="mb-3 mt-1 text-sm text-mist-300">{i.description}</p>
                {i.id === 'xp_boost_24h' && boostActive && <p className="mb-2 text-xs text-profit">Активен до {user.xpBoostUntil!.toLocaleString('bg-BG', { timeZone: 'Europe/Sofia' })} — нова покупка го удължава.</p>}
                <div className="mt-auto"><ShopBuy item={i} balance={user.coins} vip={vip} vehicles={vehicleOptions} cities={hubs} colors={STANDARD_COLORS} vipColors={VIP_COLORS} trailers={trailerOptions} /></div>
              </Card>
            ))}
          </div>
        </section>
      ))}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card id="buy" title={<span className="inline-flex items-center gap-2"><Coins className="h-4 w-4 text-cyan-glow" />Купи ТрансКоин и VIP</span>} actions={payment.enabled ? undefined : <Badge tone="violet"><Clock className="h-3 w-3" />Скоро</Badge>}>
          {cancelled && <p role="status" className="mb-3 rounded-lg border border-asphalt-600 bg-asphalt-800 px-3 py-2 text-sm text-mist-300">Плащането беше отказано — нищо не е таксувано.</p>}
          {payment.enabled ? (
            <BuyWithMoney products={PAID_PRODUCTS} testMode={payment.testMode} providers={payment.providers} />
          ) : (
            <>
              <ul className="grid grid-cols-2 gap-3">
                {PAID_PRODUCTS.map((p) => (
                  <li key={p.id} className="rounded-xl border border-asphalt-700 p-3 text-center opacity-80">
                    <div className="num font-display text-xl font-bold text-cyan-glow">{p.vipDays ? `VIP ${p.vipDays} дни` : `${p.coins.toLocaleString('bg-BG')} TC`}</div>
                    {p.bonus > 0 && <div className="text-xs text-profit">+{p.bonus} подарък</div>}
                    <div className="num mt-1 text-sm text-mist-300">{euro(p.priceCents)}</div>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-mist-400">Плащанията още не са включени. Дотогава ТрансКоин се получават като награди от екипа на играта и от ивентите.</p>
            </>
          )}
          {purchases.length > 0 && (
            <div className="mt-4 border-t border-asphalt-800 pt-3">
              <div className="label mb-1">Моите плащания</div>
              <ul className="space-y-1 text-xs">
                {purchases.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2">
                    <span>{dateTime(p.createdAt)} · {paidProduct(p.productId)?.label ?? p.productId}</span>
                    <span className="num">{euro(p.amountCents)} · <span className={p.status === 'paid' ? 'text-profit' : p.status === 'pending' ? 'text-amber-sig' : 'text-mist-400'}>{PAYMENT_STATUS_LABELS[p.status] ?? p.status}</span></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
        <Card title={<span className="inline-flex items-center gap-2"><History className="h-4 w-4 text-mist-400" />Движения по ТрансКоин</span>}>
          {history.length === 0 ? (
            <p className="text-sm text-mist-400">Още няма движения.</p>
          ) : (
            <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-2 text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex items-start justify-between gap-3 border-b border-asphalt-800 pb-1.5">
                  <span className="min-w-0">
                    <span className="block truncate">{h.description}</span>
                    <span className="text-xs text-mist-400">{COIN_REASON_LABELS[h.reason as CoinReason] ?? h.reason} · {dateTime(h.createdAt)}</span>
                  </span>
                  <span className={`num shrink-0 font-semibold ${h.amount >= 0 ? 'text-profit' : 'text-loss'}`}>{h.amount > 0 ? '+' : ''}{h.amount} TC</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

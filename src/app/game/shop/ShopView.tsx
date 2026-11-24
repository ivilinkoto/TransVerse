import { and, eq, isNull, sql } from 'drizzle-orm';
import { CheckCircle2, Clock, Coins, Crown, History } from 'lucide-react';
import { ShopBuy, type VehicleOption } from '@/components/shop/ShopBuy';
import { Badge, Card, PageHeader } from '@/components/ui';
import { BLACK_FRIDAY, BLACK_FRIDAY_MORE, isBlackFriday } from '@/lib/game/prewinter';
import { PromoRedeem } from '@/components/game/PromoRedeem';
import { dateTime } from '@/lib/format';
import { isFreightHub } from '@/lib/game/markets';
import { SHOP_CATEGORIES, SHOP_ITEMS, type ShopCategory } from '@/lib/game/shop';
import { HALLOWEEN, isHalloween } from '@/lib/game/halloween';
import { CHRISTMAS, isChristmas } from '@/lib/game/christmas';
import { VehicleIllustration } from '@/components/vehicles/VehicleIllustration';
import { isVip, STANDARD_COLORS, VIP_BENEFITS, VIP_COLORS } from '@/lib/game/vip';
import { cities, trailers, vehicles } from '@/server/db/schema';
import { coinHistory, COIN_REASON_LABELS, earnedThisWeek, type CoinReason } from '@/server/game/coins';
import { COIN_CAP } from '@/lib/game/coin-cap';
import { COSMETIC_IDS, COSMETIC_PARTS } from '@/lib/game/cosmetics';
import { nextVipLevel, unlocksAt, VIP_LEVELS } from '@/lib/game/vip-levels';
import { spentCents } from '@/server/game/vip-levels';
import { premiumPassOpen } from '@/server/game/season-pass';
import { gameContext } from '@/server/game/context';
import { BuyWithMoney } from '@/components/game/BuyWithMoney';
import { euro, paidProduct, PAID_PRODUCTS, PAYMENT_STATUS_LABELS } from '@/lib/game/payments';
import { paymentConfig, userPayments } from '@/server/payments';
import { trailerModel } from '@/lib/game/catalog';
import { isSpring } from '@/lib/game/spring';
import { isEaster } from '@/lib/game/easter';
import { t as tr, tx, intlLocale } from '@/i18n/t';
import { ActionButton } from '@/components/ui/ActionButton';
import { bonusWeekend, VIP_PRICES_V2, MONTH_CARD, OFFER_DISCOUNT, PASS_LEVEL_SALE, PATRON_LEVELS, VIP_BENEFITS_V2, vipMonthColor, WEEKEND_BONUS, weeklyOffers } from '@/lib/game/shop-v2';
import { depots } from '@/server/db/schema';
import { firstPurchaseOpen, monthCardOf, passLevelSaleOpen, patronOf, starterPackOpen, supporterPackOpen, vipCaseReady , levelOfferOf } from '@/server/game/shop-v2';
import { shopPrice } from '@/server/game/shop';
import { activeSeason } from '@/server/game/seasons';
import { ShopStore } from '@/components/shop/ShopStore';


/** The shop: the page and (1.2.3.6) the game window over any page; „Нов облик“ gets the new store. */
export async function ShopView({ cancelled = false }: { cancelled?: boolean }) {
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
  // 1.3.2.1: how much of this week's cap on earned ТрансКоин is used.
  const earnedWeek = await earnedThisWeek(db, user.id, now);
  // 1.3.2.2: the VIP level by what the player has paid, and what is left to the next one.
  const spent = await spentCents(db, user.id);
  const level = user.vipLevel ?? 0;
  const next = nextVipLevel(spent, level);
  // 1.3.2.3: the truck parts on sale now.
  const liveParts = COSMETIC_IDS.filter((p) => !!(features as Record<string, boolean>)[COSMETIC_PARTS[p].feature ?? 'cosmetics']);
  const levelCard = (
    <div className="w-full rounded-2xl border border-gold-400/30 bg-gold-400/5 p-3 text-sm" data-testid="vip-level">
      <p className="font-display text-base font-bold text-gold-300">{tr('VIP ниво {0}', level)}</p>
      <p className="text-xs text-mist-300">{next ? tr('До VIP{0} остават покупки за {1}.', next.level, euro(next.leftCents)) : tr('Най-високото ниво — благодарим ти!')}</p>
      <ul className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-mist-300 sm:grid-cols-5">
        {VIP_LEVELS.filter((l) => l.level > 0).map((l) => (
          <li key={l.level} className={`rounded-lg border px-2 py-1 ${l.level === level ? 'border-gold-400 bg-gold-400/15 text-gold-300' : 'border-asphalt-700'}`}>
            <span className="block font-semibold">{tr('VIP{0} · от {1}', l.level, euro(l.fromCents))}</span>
            <span className="block">{tr('+{0}% опит, −{1}% сервиз, +{2}% на курс', Math.round(l.xp * 100), Math.round(l.garage * 100), Math.round(l.pay * 100))}{l.depotSlots ? `, ${tr('+{0} място в депо', l.depotSlots)}` : ''}</span>
            {unlocksAt(l.level, (f) => !!(features as Record<string, boolean>)[f]).map((u) => <span key={u.label} className="block text-gold-300">🔓 {tx(u.label)}</span>)}
          </li>
        ))}
      </ul>
    </div>
  );
  const capCard = (
    <p className="w-full text-xs text-mist-400" data-testid="coin-cap-store">{tr('Спечелени TC тази седмица: {0} от {1}', Math.min(earnedWeek, COIN_CAP.weekly), COIN_CAP.weekly)}</p>
  );
  const trailerOptions = (await db.select({ id: trailers.id, plate: trailers.plate, modelId: trailers.modelId }).from(trailers).where(and(eq(trailers.companyId, company.id), eq(trailers.ownership, 'owned'), isNull(trailers.soldAt)))).map((t) => ({ id: t.id, label: `${t.plate} · ${trailerModel(t.modelId).name}` }));
  const vehicleOptions: VehicleOption[] = fleet.map((v) => ({ id: v.id, label: `${v.plate} · ${tx(v.city)}${v.ownership === 'rented' ? tr(' (нает)') : ''}${v.status !== 'idle' ? tr(' · на курс') : ''}`, owned: v.ownership === 'owned', idle: v.status === 'idle' }));
  const hubs = cityRows.filter((c) => isFreightHub({ population: c.population, country: c.country })).map((c) => ({ id: c.id, name: `${tx(c.name)} (${c.country})` }));
  const boostActive = user.xpBoostUntil && user.xpBoostUntil > now;
  const categories = (Object.keys(SHOP_CATEGORIES) as ShopCategory[]).filter((c) => c !== 'vip');
  // 1.2.3: the new shop — prices, weekly offers, VIP extras, packs and patron levels.
  const v2 = !!features.shop_v2;
  // 1.2.4 Black Friday (27–30 November): −30% on most items and a paint sold only then.
  const friday = !!features.black_friday && isBlackFriday(now);
  const priced = <T extends { id: string; price: number }>(i: T) => ({ ...i, price: shopPrice(i.id as Parameters<typeof shopPrice>[0], i.price, v2, now, friday) });
  const visible = SHOP_ITEMS.filter((i) => !i.v2 || v2);
  const offers = v2 ? weeklyOffers(now) : [];
  const vipColorsNow = v2 ? [...VIP_COLORS, vipMonthColor(now)] : VIP_COLORS;
  const depotOptions = v2 ? (await db.select({ id: depots.id, city: cities.nameBg }).from(depots).innerJoin(cities, eq(cities.id, depots.cityId)).where(eq(depots.companyId, company.id))).map((d) => ({ id: d.id, label: tx(d.city) })) : [];
  const [vipCase, card, patron, starter, first, season] = v2
    ? await Promise.all([vipCaseReady(db, user.id, user.vipUntil, now), monthCardOf(db, user.id, now), patronOf(db, user.id), starterPackOpen(db, user.id, user.level), firstPurchaseOpen(db, user.id), activeSeason(db, now)])
    : [false, null, null, false, false, null];
  // „Подкрепи TransVerse“: once per account and until the end of 2026 — first in the list while it is open.
  const supporter = v2 && features.supporter_pack && (await supporterPackOpen(db, user.id, now));
  // 1.3.2.2: the new products (and the pass only while it is not premium yet).
  const passOpen = features.paid_v3 ? await premiumPassOpen(db, user.id, now).catch(() => false) : false;
  const levelOffer = features.paid_v3 ? await levelOfferOf(db, user.id, now) : null;
  const products = PAID_PRODUCTS.filter((p) => (p.id !== 'level_offer' || !!levelOffer) && (p.id !== 'black_friday_pack' || friday) && (!p.v2 || (v2 && (p.id !== 'starter_pack' || starter) && (p.id !== 'supporter_pack' || supporter))) && (!p.feature || !!features[p.feature]) && (!p.id.startsWith('pass_') || passOpen)).sort((a, b) => Number(b.id === 'black_friday_pack') - Number(a.id === 'black_friday_pack') || Number(b.id === 'level_offer') - Number(a.id === 'level_offer') || Number(b.id === 'supporter_pack') - Number(a.id === 'supporter_pack'));
  const notes = v2 ? [levelOffer && tr('🎁 Оферта за ниво {0} — до {1}.', levelOffer.level, new Date(levelOffer.until).toLocaleString(intlLocale(), { timeZone: 'Europe/Sofia', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })), first && tr('Първата ти покупка на ТрансКоин е двойна — получаваш двойно повече TC.'), bonusWeekend(now) && tr('Бонус уикенд: +{0}% ТрансКоин на всеки пакет.', WEEKEND_BONUS * 100), friday && tr('🛍 Черен петък: +{0}% ТрансКоин на всеки пакет с TC.', BLACK_FRIDAY_MORE.packBonus * 100), patron && patron.level > 0 && tr('Покровител ниво {0}: +{1}% ТрансКоин на всеки пакет.', patron.level, patron.level)].filter((x): x is string => !!x) : [];
  const seasonOk = (i: { id: string; seasonal?: string }) => (!i.seasonal || (i.seasonal === 'halloween' ? isHalloween(now) : i.seasonal === 'spring' ? isSpring(now) && features.spring : i.seasonal === 'easter' ? isEaster(now) && features.easter : i.seasonal === 'black_friday' ? friday : isChristmas(now))) && (!i.id.startsWith('paint_retro') || features.retro_collection) && (i.id !== 'truck_part' || features.cosmetics || features.brand_parts) && (i.id !== 'trailer_part' || features.trailer_cosmetics);
  const passSale = v2 && season ? passLevelSaleOpen(season.endsAt, now) : false;
  const vipBenefits = v2 ? [...VIP_BENEFITS.map((b) => ({ ...b, items: b.items.filter((i) => i !== 'Запазване на поръчка за 10 минути') })), ...VIP_BENEFITS_V2] : VIP_BENEFITS;

  if (features.game_ui)
    return (
      <ShopStore
        coins={user.coins}
        vip={vip}
        vipUntil={vip ? user.vipUntil!.toLocaleDateString(intlLocale()) : null}
        friday={friday ? Math.round(BLACK_FRIDAY.discount * 100) : 0}
        promo={!!features.promo_codes}
        tiles={{
          offers: offers.map((id) => SHOP_ITEMS.find((i) => i.id === id)).filter((i): i is NonNullable<typeof i> => !!i).map((base) => ({ item: priced(base), was: VIP_PRICES_V2[base.id] ?? base.price, ribbon: tr('Оферта −{0}%', Math.round(OFFER_DISCOUNT * 100)) })),
          vip: SHOP_ITEMS.filter((i) => i.category === 'vip').map(priced).map((item) => ({ item })),
          ...Object.fromEntries(categories.map((cat) => [cat, visible.map(priced).filter((i) => i.category === cat && seasonOk(i)).map((item) => ({ item, ribbon: item.seasonal ? tr('Сезонно') : friday && item.price < (SHOP_ITEMS.find((x) => x.id === item.id)?.price ?? 0) ? tr('−{0}%', Math.round(BLACK_FRIDAY.discount * 100)) : undefined }))])),
        }}
        buy={{ balance: user.coins, vip, vehicles: vehicleOptions, cities: hubs, colors: STANDARD_COLORS, vipColors: vipColorsNow, trailers: trailerOptions, depots: depotOptions, parts: liveParts, vipLevel: level, friday }}
        vipBenefits={vipBenefits.map((b) => ({ group: tx(b.group), items: b.items.map((i) => tx(i)) }))}
        extras={
          <>
            {levelCard}
            {capCard}
            {v2 && vip && vipCase && <ActionButton action={{ type: 'claimVipCase' }} className="btn-gold px-3 py-2 text-sm">{tr('Вземи VIP кейса на седмицата')}</ActionButton>}
            {v2 && card?.active && (card.ready ? <ActionButton action={{ type: 'claimMonthCard' }} className="btn-primary px-3 py-2 text-sm">{tr('Вземи {0} TC за днес', MONTH_CARD.coinsPerDay)}</ActionButton> : <p className="text-xs text-mist-400">{tr('Днешните {0} TC са взети. Ела утре!', MONTH_CARD.coinsPerDay)}</p>)}
            {passSale && <ActionButton action={{ type: 'buyPassLevel' }} className="btn-gold px-3 py-2 text-sm" disabled={user.coins < PASS_LEVEL_SALE.coins}>{tr('Купи ниво от пропуска · {0} TC', PASS_LEVEL_SALE.coins)}</ActionButton>}
          </>
        }
        money={
          <div className="space-y-4">
            {cancelled && <p role="status" className="rounded-lg border border-asphalt-600 bg-asphalt-800 px-3 py-2 text-sm text-mist-300">{tr('Плащането беше отказано — нищо не е таксувано.')}</p>}
            {payment.enabled ? (
              <BuyWithMoney products={products} testMode={payment.testMode} providers={payment.providers} notes={notes} gift={!!features.gift_tc} />
            ) : (
              <>
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {products.map((p) => (
                    <li key={p.id} className="shop-tile flex flex-col items-center gap-1 rounded-2xl p-3 text-center" style={{ '--tile': '#22d3ee' } as React.CSSProperties}>
                      <span className="text-3xl" aria-hidden>{p.id === 'supporter_pack' ? '❤️' : '💎'}</span>
                      <span className="num font-display text-lg font-bold text-cyan-glow">{p.v2 ? tx(p.label) : p.vipDays ? tr('VIP {0} дни', p.vipDays) : `${p.coins.toLocaleString(intlLocale())} TC`}</span>
                      {p.bonus > 0 && <span className="text-xs text-profit">{tr('+{0} подарък', p.bonus)}</span>}
                      <span className="num text-sm text-mist-300">{euro(p.priceCents)}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-mist-400">{tr('Плащанията още не са включени. Дотогава ТрансКоин се получават като награди от екипа на играта и от ивентите.')}</p>
              </>
            )}
            {history.length > 0 && (
              <div>
                <div className="label mb-1">{tr('Движения по ТрансКоин')}</div>
                <ul className="max-h-60 space-y-1.5 overflow-y-auto pr-2 text-sm">
                  {history.map((h) => (
                    <li key={h.id} className="flex items-start justify-between gap-3 border-b border-white/5 pb-1.5">
                      <span className="min-w-0"><span className="block truncate">{tx(h.description)}</span><span className="text-xs text-mist-400">{tx(COIN_REASON_LABELS[h.reason as CoinReason] ?? h.reason)} · {dateTime(h.createdAt)}</span></span>
                      <span className={`num shrink-0 font-semibold ${h.amount >= 0 ? 'text-profit' : 'text-loss'}`}>{h.amount > 0 ? '+' : ''}{tx(h.amount)} TC</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        }
        promoBox={features.promo_codes ? <PromoRedeem compact /> : null}
      />
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title={tr('Магазин')}
        subtitle={tr('VIP, удобства и стил за твоята компания.')}
        help={tr('ТрансКоин (TC) е премиум валутата на TransVerse. С нея се купуват VIP, удобства и козметика — никога игрови пари, за да е честно за всички.')}
        actions={<span className="flex items-center gap-2 rounded-xl border border-cyan-glow/30 bg-cyan-glow/10 px-4 py-2"><Coins className="h-5 w-5 text-cyan-glow" /><span className="num font-display text-xl font-bold text-cyan-glow">{user.coins.toLocaleString(intlLocale())} TC</span></span>}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-asphalt-700 bg-asphalt-900/70 px-4 py-3 text-sm" data-testid="coin-cap">
        <span>{tr('Спечелени TC тази седмица: {0} от {1}', Math.min(earnedWeek, COIN_CAP.weekly), COIN_CAP.weekly)}</span>
        <span className="text-xs text-mist-400">{earnedWeek >= COIN_CAP.weekly ? tr('Таванът е достигнат: до понеделник наградите идват в пари ({0} лв. за 1 TC).', COIN_CAP.centsPerCoin / 100) : tr('Над тавана наградите идват в пари. Купените TC не се броят.')}</span>
      </div>

      {friday && (
        <div className="rounded-2xl border border-gold-400/50 bg-gradient-to-r from-black/60 to-gold-400/10 p-4" data-testid="black-friday">
          <div className="font-display text-lg font-bold text-gold-300">{tr('🛍 Черен петък · −{0}%', Math.round(BLACK_FRIDAY.discount * 100))}</div>
          <p className="mt-1 text-sm text-mist-300">{tr('До 30 ноември почти всичко в магазина е с −{0}% (без VIP и частите), а боята „Черен петък“ се продава само сега.', Math.round(BLACK_FRIDAY.discount * 100))}</p>
        </div>
      )}

      {features.promo_codes && (
        <Card title={tr('🎟 Имаш код?')}>
          <PromoRedeem compact />
        </Card>
      )}

      <Card title={<span className="inline-flex items-center gap-2"><Crown className="h-4 w-4 text-gold-400" />VIP</span>} actions={vip ? <Badge tone="gold">{tr('Активен до {0}', user.vipUntil!.toLocaleDateString(intlLocale()))}</Badge> : <Badge>{tr('Нямаш VIP')}</Badge>}>
        <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          <div className="grid gap-4 sm:grid-cols-2">
            {vipBenefits.map((b) => (
              <div key={b.group}>
                <div className="label mb-1.5">{tx(b.group)}</div>
                <ul className="space-y-1 text-sm">
                  {b.items.map((i) => <li key={i} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-gold-400" />{tx(i)}</li>)}
                </ul>
              </div>
            ))}
            <p className="text-xs text-mist-400 sm:col-span-2">{tr('VIP не дава сезонни точки и не влияе на класациите — предимствата са умерени, за да е честно за всички.')}</p>
          </div>
          <div className="space-y-3">
            {v2 && vip && vipCase && (
              <div className="flex flex-wrap gap-2">
                {<ActionButton action={{ type: 'claimVipCase' }} className="btn-gold px-3 py-2 text-sm">{tr('Вземи VIP кейса на седмицата')}</ActionButton>}
              </div>
            )}
            {v2 && card?.active && (
              <div className="rounded-xl border border-cyan-glow/40 bg-cyan-glow/5 p-3 text-sm">
                <div className="font-semibold">{tr('Месечна карта · до {0}', card.until!.toLocaleDateString(intlLocale()))}</div>
                {card.ready ? <ActionButton action={{ type: 'claimMonthCard' }} className="btn-primary mt-2 px-3 py-1.5 text-sm">{tr('Вземи {0} TC за днес', MONTH_CARD.coinsPerDay)}</ActionButton> : <p className="mt-1 text-xs text-mist-400">{tr('Днешните {0} TC са взети. Ела утре!', MONTH_CARD.coinsPerDay)}</p>}
              </div>
            )}
            {SHOP_ITEMS.filter((i) => i.category === 'vip').map(priced).map((i) => (
              <div key={i.id} className="rounded-xl border border-gold-400/30 bg-gold-400/5 p-3">
                <div className="flex items-center justify-between gap-2"><span className="font-semibold">{tx(i.label)}</span><span className="num font-bold text-cyan-glow">{tx(i.price)} TC</span></div>
                <p className="mb-2 mt-1 text-xs text-mist-400">{tx(i.description)}</p>
                <ShopBuy item={i} balance={user.coins} vip={vip} vehicles={vehicleOptions} cities={hubs} colors={STANDARD_COLORS} vipColors={vipColorsNow} parts={liveParts} vipLevel={level} friday={friday} />
              </div>
            ))}
            {v2 && <p className="text-xs text-mist-400">{tr('С истински пари VIP за 30 дни е най-изгодно — виж „Купи ТрансКоин и VIP“ по-долу.')}</p>}
          </div>
        </div>
      </Card>

      {v2 && offers.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-lg font-bold">{tr('Оферти на седмицата · −{0}%', Math.round(OFFER_DISCOUNT * 100))}</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {offers.map((id) => SHOP_ITEMS.find((i) => i.id === id)).filter((i): i is NonNullable<typeof i> => !!i).map((base) => {
              const i = priced(base);
              return (
                <Card key={i.id} className="flex flex-col border-gold-400/40">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-display font-bold">{tx(i.label)}</div>
                    <span className="num shrink-0 text-right"><span className="block text-xs text-mist-400 line-through">{VIP_PRICES_V2[base.id] ?? base.price} TC</span><span className="font-bold text-gold-400">{i.price} TC</span></span>
                  </div>
                  <p className="mb-3 mt-1 text-sm text-mist-300">{tx(i.description)}</p>
                  <div className="mt-auto"><ShopBuy item={i} balance={user.coins} vip={vip} vehicles={vehicleOptions} cities={hubs} colors={STANDARD_COLORS} vipColors={vipColorsNow} trailers={trailerOptions} depots={depotOptions} parts={liveParts} vipLevel={level} friday={friday} /></div>
                </Card>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-mist-400">{tr('Офертите се сменят всеки понеделник.')}</p>
        </section>
      )}

      {passSale && (
        <Card title={tr('Последна седмица на сезона: ниво от пропуска')}>
          <p className="text-sm text-mist-300">{tr('Едно ниво на Truck Pass за {0} TC — само точки за пропуска, без сезонни точки и класиране.', PASS_LEVEL_SALE.coins)}</p>
          <ActionButton action={{ type: 'buyPassLevel' }} className="btn-gold mt-3 px-3 py-2 text-sm" disabled={user.coins < PASS_LEVEL_SALE.coins}>{tr('Купи ниво · {0} TC', PASS_LEVEL_SALE.coins)}</ActionButton>
        </Card>
      )}

      {categories.map((cat) => (
        <section key={cat}>
          <h2 className="mb-3 font-display text-lg font-bold">{tx(SHOP_CATEGORIES[cat])}</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visible.map(priced).filter((i) => i.category === cat && (!i.seasonal || (i.seasonal === 'halloween' ? isHalloween(now) : i.seasonal === 'spring' ? isSpring(now) && features.spring : i.seasonal === 'easter' ? isEaster(now) && features.easter : i.seasonal === 'black_friday' ? friday : isChristmas(now))) && (!i.id.startsWith('paint_retro') || features.retro_collection) && (i.id !== 'truck_part' || features.cosmetics || features.brand_parts) && (i.id !== 'trailer_part' || features.trailer_cosmetics)).map((i) => (
              <Card key={i.id} className="flex flex-col">
                {i.id === 'paint_christmas' && <VehicleIllustration modelId="danubia-t440" trailerModelId="curtain-13" color={CHRISTMAS.paintColor} livery="christmas" className="mb-3 h-16 w-full" />}
                {i.id === 'trailer_part' && <VehicleIllustration modelId="danubia-t440" trailerModelId="curtain-13" color="#111827" trailerCosmetics={{ paint: '#111827', stripe: 'gold', flaps: 'chrome', toplights: 'amber' }} className="mb-3 h-16 w-full" />}
                {i.id === 'truck_part' && <VehicleIllustration modelId="danubia-t440" color="#1d4ed8" cosmetics={{ grille: 'chrome', lights: 'amber', visor: 'body', sticker: 'TRANSVERSE' }} className="mb-3 h-16 w-full" />}
                {i.id === 'paint_pumpkin' && <VehicleIllustration modelId="danubia-t440" trailerModelId="curtain-13" color={HALLOWEEN.pumpkinColor} livery="pumpkin" className="mb-3 h-16 w-full" />}
                <div className="flex items-start justify-between gap-2">
                  <div className="font-display font-bold">{tx(i.label)}</div>
                  <span className="num shrink-0 font-bold text-cyan-glow">{i.id === 'truck_part' || i.id === 'trailer_part' ? tr('от ') : ''}{i.id === 'paint' && vip ? '0' : i.price} TC</span>
                </div>
                <p className="mb-3 mt-1 text-sm text-mist-300">{tx(i.description)}</p>
                {i.id === 'xp_boost_24h' && boostActive && <p className="mb-2 text-xs text-profit">{tr('Активен до {0} — нова покупка го удължава.', user.xpBoostUntil!.toLocaleString(intlLocale(), { timeZone: 'Europe/Sofia' }))}</p>}
                {i.id === 'instant_repair' && v2 && vip && <p className="mb-2 text-xs text-gold-400">{tr('VIP: един ремонт на ден е безплатен.')}</p>}
                <div className="mt-auto"><ShopBuy item={i} balance={user.coins} vip={vip} vehicles={vehicleOptions} cities={hubs} colors={STANDARD_COLORS} vipColors={vipColorsNow} trailers={trailerOptions} depots={depotOptions} /></div>
              </Card>
            ))}
          </div>
        </section>
      ))}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card id="buy" title={<span className="inline-flex items-center gap-2"><Coins className="h-4 w-4 text-cyan-glow" />{tr('Купи ТрансКоин и VIP')}</span>} actions={payment.enabled ? undefined : <Badge tone="violet"><Clock className="h-3 w-3" />{tr('Скоро')}</Badge>}>
          {cancelled && <p role="status" className="mb-3 rounded-lg border border-asphalt-600 bg-asphalt-800 px-3 py-2 text-sm text-mist-300">{tr('Плащането беше отказано — нищо не е таксувано.')}</p>}
          {payment.enabled ? (
            <>
              <BuyWithMoney products={products} testMode={payment.testMode} providers={payment.providers} notes={notes} gift={!!features.gift_tc} />
              {v2 && patron && (
                <p className="mt-3 text-xs text-mist-400">{patron.level < PATRON_LEVELS.length ? tr('Покровител ниво {0} от {1}. Следващото — след още {2}: всяко ниво дава +1% ТрансКоин на покупките завинаги.', patron.level, PATRON_LEVELS.length, euro(PATRON_LEVELS[patron.level]! - patron.paidCents)) : tr('Покровител ниво {0} — най-високото. Благодарим ти!', patron.level)}</p>
              )}
            </>
          ) : (
            <>
              <ul className="grid grid-cols-2 gap-3">
                {products.map((p) => (
                  <li key={p.id} className="rounded-xl border border-asphalt-700 p-3 text-center opacity-80">
                    <div className="num font-display text-xl font-bold text-cyan-glow">{p.v2 ? tx(p.label) : p.vipDays ? tr('VIP {0} дни', p.vipDays) : `${p.coins.toLocaleString(intlLocale())} TC`}</div>
                    {p.bonus > 0 && <div className="text-xs text-profit">{tr('+{0} подарък', p.bonus)}</div>}
                    <div className="num mt-1 text-sm text-mist-300">{euro(p.priceCents)}</div>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-mist-400">{tr('Плащанията още не са включени. Дотогава ТрансКоин се получават като награди от екипа на играта и от ивентите.')}</p>
            </>
          )}
          {purchases.length > 0 && (
            <div className="mt-4 border-t border-asphalt-800 pt-3">
              <div className="label mb-1">{tr('Моите плащания')}</div>
              <ul className="space-y-1 text-xs">
                {purchases.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2">
                    <span>{dateTime(p.createdAt)} · {paidProduct(p.productId)?.label ?? p.productId}</span>
                    <span className="num">{euro(p.amountCents)} · <span className={p.status === 'paid' ? 'text-profit' : p.status === 'pending' ? 'text-amber-sig' : 'text-mist-400'}>{tx(PAYMENT_STATUS_LABELS[p.status] ?? p.status)}</span></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
        <Card title={<span className="inline-flex items-center gap-2"><History className="h-4 w-4 text-mist-400" />{tr('Движения по ТрансКоин')}</span>}>
          {history.length === 0 ? (
            <p className="text-sm text-mist-400">{tr('Още няма движения.')}</p>
          ) : (
            <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-2 text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex items-start justify-between gap-3 border-b border-asphalt-800 pb-1.5">
                  <span className="min-w-0">
                    <span className="block truncate">{tx(h.description)}</span>
                    <span className="text-xs text-mist-400">{tx(COIN_REASON_LABELS[h.reason as CoinReason] ?? h.reason)} · {dateTime(h.createdAt)}</span>
                  </span>
                  <span className={`num shrink-0 font-semibold ${h.amount >= 0 ? 'text-profit' : 'text-loss'}`}>{h.amount > 0 ? '+' : ''}{tx(h.amount)} TC</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

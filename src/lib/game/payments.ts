/**
 * What can be bought for real money. Pure data shared by server and UI; the
 * server always charges these prices — never an amount sent by the browser.
 * Game money (лв. in the game) is never sold; real prices are in euro.
 */

export type PaidProductId = 'tc_100' | 'tc_550' | 'tc_1200' | 'tc_3200' | 'vip_30_direct' | 'starter_pack' | 'month_card' | 'supporter_pack' | 'tc_60' | 'speed_pack' | 'pass_premium' | 'pass_plus' | 'gold_cases_10' | 'vip_plus' | 'level_offer' | 'black_friday_pack';

export interface PaidProduct {
  id: PaidProductId;
  label: string;
  description: string;
  /** Final price to the buyer, euro cents. */
  priceCents: number;
  coins: number;
  /** Gift coins included in `coins` (shown as a bonus). */
  bonus: number;
  vipDays: number;
  /** 1.2.3: sold only with the new shop (`shop_v2`). */
  v2?: boolean;
  /** 1.3.2.2: sold from this feature on (the staff see it before). */
  feature?: 'paid_v3' | 'black_friday';
}

/** 1.3.2.2: the plain ТрансКоин packs can be bought for another player (`gift_tc`). */
export const giftable = (p: Pick<PaidProduct, 'id' | 'vipDays'>) => p.id.startsWith('tc_') && !p.vipDays;

export const PAID_PRODUCTS: PaidProduct[] = [
  // 1.3.2.4: sold only on Black Friday (27–30 November).
  { id: 'black_friday_pack', label: 'Пакет „Черен петък“', description: '3 000 TC, 30 дни VIP и 3 златни кейса — само от 27 до 30 ноември.', priceCents: 2499, coins: 3000, bonus: 0, vipDays: 30, feature: 'black_friday' },
  // 1.3.2.2: more to buy — the smallest pack, the season pass and boosters for real money.
  { id: 'tc_60', label: 'Шепа ТрансКоин', description: '60 TC — най-малкият пакет.', priceCents: 99, coins: 60, bonus: 0, vipDays: 0, feature: 'paid_v3' },
  { id: 'speed_pack', label: 'Пакет „Бързо“', description: '250 TC за ускоряване на курсове и 3 дни бустер +50% пари.', priceCents: 299, coins: 250, bonus: 0, vipDays: 0, feature: 'paid_v3' },
  { id: 'pass_premium', label: 'Truck Pass Премиум', description: 'Премиум линията на пропуска за текущия сезон — наградите от достигнатите нива се взимат веднага.', priceCents: 499, coins: 0, bonus: 0, vipDays: 0, feature: 'paid_v3' },
  { id: 'pass_plus', label: 'Truck Pass Премиум+', description: 'Премиум линията на пропуска за текущия сезон и +15 000 точки за пропуска (няколко нива веднага).', priceCents: 999, coins: 0, bonus: 0, vipDays: 0, feature: 'paid_v3' },
  { id: 'gold_cases_10', label: '10 златни кейса', description: 'Десет златни кейса в инвентара — редки предмети и шанс за номериран златен ключ.', priceCents: 999, coins: 0, bonus: 0, vipDays: 0, feature: 'paid_v3' },
  { id: 'vip_plus', label: 'VIP+ · 30 дни', description: '30 дни VIP, 1 200 TC и 7 дни бустер +50% пари.', priceCents: 1499, coins: 1200, bonus: 0, vipDays: 30, feature: 'paid_v3' },
  { id: 'level_offer', label: 'Оферта за новото ниво', description: '600 TC, 3 дни бустер +50% пари и златен кейс — само 48 часа след като стигнеш ниво 5, 10, 15, 20, 25, 30, 40 или 50.', priceCents: 499, coins: 600, bonus: 0, vipDays: 0, feature: 'paid_v3' },
  { id: 'tc_100', label: '100 ТрансКоин', description: '100 TC за магазина на играта.', priceCents: 199, coins: 100, bonus: 0, vipDays: 0 },
  { id: 'tc_550', label: '550 ТрансКоин', description: '500 TC + 50 подарък.', priceCents: 999, coins: 550, bonus: 50, vipDays: 0 },
  { id: 'tc_1200', label: '1 200 ТрансКоин', description: '1 000 TC + 200 подарък.', priceCents: 1999, coins: 1200, bonus: 200, vipDays: 0 },
  { id: 'tc_3200', label: '3 200 ТрансКоин', description: '2 500 TC + 700 подарък.', priceCents: 4999, coins: 3200, bonus: 700, vipDays: 0 },
  { id: 'starter_pack', label: 'Начален пакет', description: '300 TC, 7 дни VIP и сребърен кейс. Веднъж за профил, от ниво 3.', priceCents: 299, coins: 300, bonus: 0, vipDays: 7, v2: true },
  { id: 'month_card', label: 'Месечна карта', description: '30 дни VIP и по 30 TC всеки ден, в който влезеш (до 900 TC).', priceCents: 499, coins: 0, bonus: 0, vipDays: 30, v2: true },
  { id: 'supporter_pack', label: 'Подкрепи TransVerse', description: 'Значка „Поддръжник от първите дни“ завинаги и 300 TC. Веднъж за профил, до края на 2026 г. Помагаш ни да плащаме сървъра и да развиваме играта.', priceCents: 499, coins: 300, bonus: 0, vipDays: 0, v2: true },
  { id: 'vip_30_direct', label: 'VIP · 30 дни', description: 'Всички VIP предимства за 30 дни, добавени към текущия ти VIP.', priceCents: 999, coins: 0, bonus: 0, vipDays: 30 },
];

export const paidProduct = (id: string) => PAID_PRODUCTS.find((p) => p.id === id);

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'очаква плащане',
  paid: 'платено',
  failed: 'неуспешно',
  expired: 'изтекло',
  refunded: 'възстановено',
};

export const euro = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

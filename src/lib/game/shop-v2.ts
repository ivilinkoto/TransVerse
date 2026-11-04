/**
 * 1.2.3 „Отворен път“: the new shop (feature `shop_v2`). Pure data and rules
 * shared by the server and the pages; the server always decides prices.
 */
import type { ShopItemId } from './shop';

const DAY = 86_400_000;

/** VIP for ТрансКоин costs more with the new shop; the direct VIP (real money) is the better deal. */
export const VIP_PRICES_V2: Partial<Record<ShopItemId, number>> = { vip_7: 300, vip_30: 1000, vip_90: 2700, gift_vip_30: 1000 };

/** What VIP adds with the new shop (on top of VIP_PERKS). */
export const VIP_V2 = {
  /** The daily reward (money and ТрансКоин) is doubled. */
  dailyMultiplier: 2,
  /** A free „Моментален ремонт“ once a day (Sofia day). */
  freeRepairsPerDay: 1,
  /** A silver case every week (ISO week, claimed on the shop page or in „Награди“). */
  weeklyCase: 'case_silver' as const,
  /** Diesel (and electricity) cheaper by this share. */
  fuelDiscount: 0.03,
} as const;

/** Benefits added to the VIP card with the new shop (Bulgarian, translated through the catalog). */
export const VIP_BENEFITS_V2: { group: string; items: string[] }[] = [
  { group: 'Всеки ден и седмица', items: ['Двойна дневна награда', 'Безплатен моментален ремонт веднъж на ден', 'Сребърен кейс всяка седмица', 'Боя на месеца — нов ексклузивен цвят всеки месец'] },
  { group: 'По пътя', items: ['−3% гориво', 'Запазване на поръчка за 30 минути', '+1 месечна мисия', 'Запитванията ти до поддръжката се виждат първи'] },
];

/** One exclusive VIP colour each month (on top of VIP_COLORS); the paint stays on the truck. */
const MONTH_COLORS = ['#b8860b', '#4b0082', '#008b8b', '#c71585', '#2e8b57', '#ff4500', '#1e90ff', '#8b0000', '#9acd32', '#ff1493', '#00ced1', '#daa520'];
export function vipMonthColor(now: Date): string {
  const m = Number(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Sofia', month: 'numeric' }).format(now)) - 1;
  return MONTH_COLORS[m]!;
}

/** Sofia calendar day key (YYYY-MM-DD). */
export const sofiaDay = (now: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(now);

/** ISO week key (YYYY-Www) by Sofia time. */
export function isoWeek(now: Date): string {
  const [y, m, d] = sofiaDay(now).split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dow + 3);
  const firstThu = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date.getTime() - firstThu.getTime()) / DAY - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ---------- weekly offers ----------
/** Items that may be on offer; three of them each week at −25 %. */
const OFFER_POOL: ShopItemId[] = ['vip_7', 'xp_boost_24h', 'instant_repair', 'instant_relocate', 'custom_plate', 'case_silver', 'case_gold', 'truck_part', 'trailer_part', 'move_depot'];
export const OFFER_DISCOUNT = 0.25;
export function weeklyOffers(now: Date): ShopItemId[] {
  const key = isoWeek(now);
  let h = 0; for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const pool = [...OFFER_POOL]; const out: ShopItemId[] = [];
  while (out.length < 3 && pool.length) { h = (h * 1103515245 + 12345) >>> 0; out.push(pool.splice(h % pool.length, 1)[0]!); }
  return out;
}
export const offerPrice = (price: number) => Math.max(1, Math.round(price * (1 - OFFER_DISCOUNT)));

// ---------- real-money extras ----------
/** The first purchase of ТрансКоин gives the same amount again, once per account. */
export const FIRST_PURCHASE_MULTIPLIER = 2;
/** The first weekend of each month (Sofia): +20 % ТрансКоин on every pack. */
export const WEEKEND_BONUS = 0.2;
export function bonusWeekend(now: Date): boolean {
  const [, , d] = sofiaDay(now).split('-').map(Number) as [number, number, number];
  const dow = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Sofia', weekday: 'short' }).format(now);
  return (dow === 'Sat' && d <= 7) || (dow === 'Sun' && d <= 8 && d >= 2);
}
/** Invited friend's first purchase: the inviter gets this share of its ТрансКоин. */
export const REFERRAL_PURCHASE_SHARE = 0.1;
/** The monthly card: VIP for 30 days and this many ТрансКоин to claim every day. */
export const MONTH_CARD = { days: 30, coinsPerDay: 30 } as const;
/** The starter pack (once per account): ТрансКоин, VIP days and a silver case. */
export const STARTER_PACK = { minLevel: 3, case: 'case_silver' as const } as const;

/** Patron levels by everything paid (euro cents, refunds excluded): +1 % ТрансКоин per level on later packs. */
export const PATRON_LEVELS = [500, 1500, 3000, 5000, 8000, 12000, 18000, 25000, 35000, 50000];
export function patronLevel(paidCents: number): number { return PATRON_LEVELS.filter((c) => paidCents >= c).length; }
export const patronBonus = (level: number) => level / 100;

// ---------- Truck Pass ----------
/** In the last days of a season a pass level can be bought (pass points only — never season points). */
export const PASS_LEVEL_SALE = { lastDays: 7, coins: 150, points: 1000 } as const;

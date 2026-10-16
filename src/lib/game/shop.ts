/**
 * ТрансКоин shop. Prices in whole coins. Pure data shared by server and UI.
 * Game money (€) is deliberately never sold for ТрансКоин.
 */

export type ShopCategory = 'vip' | 'boost' | 'service' | 'cosmetic' | 'account';

export const SHOP_CATEGORIES: Record<ShopCategory, string> = {
  vip: 'VIP',
  boost: 'Бустери',
  service: 'Услуги за камиона',
  cosmetic: 'Козметика',
  account: 'Профил',
};

export type ShopItemId = 'vip_7' | 'vip_30' | 'vip_90' | 'gift_vip_30' | 'xp_boost_24h' | 'instant_repair' | 'instant_relocate' | 'custom_plate' | 'paint' | 'rename';

export interface ShopItem {
  id: ShopItemId;
  category: ShopCategory;
  label: string;
  description: string;
  price: number;
  /** What the buyer has to choose. */
  needs?: 'vehicle' | 'vehicle_city' | 'vehicle_plate' | 'vehicle_color' | 'username' | 'recipient';
}

export const SHOP_ITEMS: ShopItem[] = [
  { id: 'vip_7', category: 'vip', label: 'VIP · 7 дни', description: 'Всички VIP предимства за една седмица. Добавя се към текущия ти VIP.', price: 150 },
  { id: 'vip_30', category: 'vip', label: 'VIP · 30 дни', description: 'Всички VIP предимства за месец.', price: 500 },
  { id: 'vip_90', category: 'vip', label: 'VIP · 90 дни', description: 'Три месеца VIP — най-изгодно.', price: 1200 },
  { id: 'gift_vip_30', category: 'vip', label: 'Подари VIP · 30 дни', description: 'Подари 30 дни VIP на друг играч.', price: 500, needs: 'recipient' },
  { id: 'xp_boost_24h', category: 'boost', label: '×2 опит · 24 часа', description: 'Двоен опит от доставки за 24 часа. Не влияе на сезонните точки.', price: 120 },
  { id: 'instant_repair', category: 'service', label: 'Моментален ремонт', description: 'Собствен камион (и ремаркето му) до 100% без разход на €.', price: 40, needs: 'vehicle' },
  { id: 'instant_relocate', category: 'service', label: 'Моментално преместване', description: 'Свободен камион (с ремаркето) веднага в друг град от товарния пазар.', price: 60, needs: 'vehicle_city' },
  { id: 'custom_plate', category: 'cosmetic', label: 'Лична регистрационна табела', description: 'Собствен надпис на табелата на твой камион (2–10 знака).', price: 150, needs: 'vehicle_plate' },
  { id: 'paint', category: 'cosmetic', label: 'Пребоядисване', description: 'Нов цвят на твой камион. За VIP е безплатно и с ексклузивни цветове.', price: 50, needs: 'vehicle_color' },
  { id: 'rename', category: 'account', label: 'Смяна на потребителско име', description: 'Ново име в играта (3–20 знака).', price: 300, needs: 'username' },
];

export const shopItem = (id: string) => SHOP_ITEMS.find((i) => i.id === id);

export const VIP_DAYS: Partial<Record<ShopItemId, number>> = { vip_7: 7, vip_30: 30, vip_90: 90, gift_vip_30: 30 };

/** Packages for real money (stage 2 — not on sale until a payment provider is connected). */
export const COIN_PACKAGES = [
  { id: 'tc_100', coins: 100, bonus: 0, priceEur: 1.99 },
  { id: 'tc_550', coins: 500, bonus: 50, priceEur: 9.99 },
  { id: 'tc_1200', coins: 1000, bonus: 200, priceEur: 19.99 },
  { id: 'tc_3200', coins: 2500, bonus: 700, priceEur: 49.99 },
] as const;

export const PLATE_PATTERN = /^[A-ZА-Я0-9][A-ZА-Я0-9 -]{0,8}[A-ZА-Я0-9]$/u;

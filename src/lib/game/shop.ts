/**
 * ТрансКоин shop. Prices in whole coins. Pure data shared by server and UI.
 * Game money (лв.) is deliberately never sold for ТрансКоин.
 */

export type ShopCategory = 'vip' | 'boost' | 'service' | 'cosmetic' | 'account';

export const SHOP_CATEGORIES: Record<ShopCategory, string> = {
  vip: 'VIP',
  boost: 'Бустери',
  service: 'Услуги за камиона',
  cosmetic: 'Козметика',
  account: 'Профил',
};

export type ShopItemId = 'vip_7' | 'vip_30' | 'vip_90' | 'gift_vip_30' | 'xp_boost_24h' | 'instant_repair' | 'instant_relocate' | 'custom_plate' | 'paint' | 'paint_pumpkin' | 'paint_christmas' | 'paint_cherry' | 'paint_retro70' | 'paint_retro80' | 'paint_retro90' | 'truck_part' | 'trailer_part' | 'rename';

/** The retro collection (v1.5): three paints of past decades; all three earn a badge. */
export const RETRO = {
  retro70: { color: '#7c4a21', stripes: ['#f97316', '#facc15', '#b45309'] },
  retro80: { color: '#1e1b4b', stripes: ['#ec4899', '#22d3ee', '#a78bfa'] },
  retro90: { color: '#0f766e', stripes: ['#a855f7', '#2dd4bf', '#f8fafc'] },
} as const;
export type RetroStyle = keyof typeof RETRO;
export const RETRO_BADGE = 'retro-collector';

export interface ShopItem {
  id: ShopItemId;
  category: ShopCategory;
  label: string;
  description: string;
  price: number;
  /** What the buyer has to choose. */
  needs?: 'vehicle' | 'vehicle_city' | 'vehicle_plate' | 'vehicle_color' | 'vehicle_cosmetic' | 'trailer_cosmetic' | 'username' | 'recipient';
  /** Sold only during this holiday (what was bought stays). */
  seasonal?: 'halloween' | 'christmas' | 'spring';
}

export const SHOP_ITEMS: ShopItem[] = [
  { id: 'vip_7', category: 'vip', label: 'VIP · 7 дни', description: 'Всички VIP предимства за една седмица. Добавя се към текущия ти VIP.', price: 150 },
  { id: 'vip_30', category: 'vip', label: 'VIP · 30 дни', description: 'Всички VIP предимства за месец.', price: 500 },
  { id: 'vip_90', category: 'vip', label: 'VIP · 90 дни', description: 'Три месеца VIP — най-изгодно.', price: 1200 },
  { id: 'gift_vip_30', category: 'vip', label: 'Подари VIP · 30 дни', description: 'Подари 30 дни VIP на друг играч.', price: 500, needs: 'recipient' },
  { id: 'xp_boost_24h', category: 'boost', label: '×2 опит · 24 часа', description: 'Двоен опит от доставки за 24 часа. Не влияе на сезонните точки.', price: 120 },
  { id: 'instant_repair', category: 'service', label: 'Моментален ремонт', description: 'Собствен камион (и ремаркето му) до 100% без разход на лв.', price: 40, needs: 'vehicle' },
  { id: 'instant_relocate', category: 'service', label: 'Моментално преместване', description: 'Свободен камион (с ремаркето) веднага в друг град от товарния пазар.', price: 60, needs: 'vehicle_city' },
  { id: 'custom_plate', category: 'cosmetic', label: 'Лична регистрационна табела', description: 'Собствен надпис на табелата на твой камион (2–10 знака).', price: 150, needs: 'vehicle_plate' },
  { id: 'paint', category: 'cosmetic', label: 'Пребоядисване', description: 'Нов цвят на твой камион. За VIP е безплатно и с ексклузивни цветове.', price: 50, needs: 'vehicle_color' },
  { id: 'paint_pumpkin', category: 'cosmetic', label: 'Боя „Тиква“ · Хелуин 2026', description: 'Празнична оранжева боя с тиквена усмивка на кабината и ремаркето. Продава се само по Хелуин — остава на камиона завинаги (до пребоядисване).', price: 80, needs: 'vehicle', seasonal: 'halloween' },
  { id: 'paint_christmas', category: 'cosmetic', label: 'Боя „Коледа“ · Коледа 2026', description: 'Празнична червена боя с украсена елха на кабината и ремаркето. Продава се само по Коледа — остава на камиона завинаги (до пребоядисване).', price: 80, needs: 'vehicle', seasonal: 'christmas' },
  { id: 'paint_cherry', category: 'cosmetic', label: 'Боя „Цъфнала череша“ · Пролет 2027', description: 'Нежнорозова боя с черешов цвят на кабината и ремаркето. Продава се от 16 март до 15 април — остава на камиона.', price: 70, needs: 'vehicle', seasonal: 'spring' },
  { id: 'paint_retro70', category: 'cosmetic', label: 'Ретро боя „70-те“', description: 'Кафяво-оранжева боя с ивици като на камионите от 70-те. Част от ретро колекцията — събери трите за значка.', price: 60, needs: 'vehicle' },
  { id: 'paint_retro80', category: 'cosmetic', label: 'Ретро боя „80-те“', description: 'Тъмносиня боя с неоново розово и синьо от 80-те. Част от ретро колекцията — събери трите за значка.', price: 60, needs: 'vehicle' },
  { id: 'paint_retro90', category: 'cosmetic', label: 'Ретро боя „90-те“', description: 'Тюркоазено-лилава боя с ивици от 90-те. Част от ретро колекцията — събери трите за значка.', price: 60, needs: 'vehicle' },
  { id: 'truck_part', category: 'cosmetic', label: 'Части за камиона', description: 'Решетка, светлини на покрива, сенник или стикер с името на компанията на вратата. Остават на камиона; нов стил на същата част заменя стария.', price: 50, needs: 'vehicle_cosmetic' },
  { id: 'trailer_part', category: 'cosmetic', label: 'Части за ремаркето', description: 'Боя, лента, калници или светлини на покрива на твое ремарке. Остават на него; нов стил на същата част заменя стария.', price: 30, needs: 'trailer_cosmetic' },
  { id: 'rename', category: 'account', label: 'Смяна на потребителско име', description: 'Ново име в играта (3–20 знака).', price: 300, needs: 'username' },
];

export const shopItem = (id: string) => SHOP_ITEMS.find((i) => i.id === id);

export const VIP_DAYS: Partial<Record<ShopItemId, number>> = { vip_7: 7, vip_30: 30, vip_90: 90, gift_vip_30: 30 };


export const PLATE_PATTERN = /^[A-ZА-Я0-9][A-ZА-Я0-9 -]{0,8}[A-ZА-Я0-9]$/u;

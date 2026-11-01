/**
 * 1.2 „Инвентар“: items a player keeps, uses or collects. Each one has its
 * own drawing (components/game/ItemArt.tsx). Cases are won by playing only —
 * never sold for money — and show the chance of every item inside. Game data.
 */
export const RARITIES = {
  common: { label: 'Обикновен', color: '#94a3b8' },
  uncommon: { label: 'Необикновен', color: '#38bdf8' },
  rare: { label: 'Рядък', color: '#a855f7' },
  epic: { label: 'Епичен', color: '#f59e0b' },
  legendary: { label: 'Легендарен', color: '#f43f5e' },
} as const;
export type Rarity = keyof typeof RARITIES;

/** What a used item needs to be pointed at. */
export type ItemTarget = 'none' | 'driver' | 'vehicle';

export interface ItemDef {
  name: string;
  rarity: Rarity;
  kind: 'consumable' | 'cosmetic' | 'collectible' | 'case';
  target: ItemTarget;
  /** What it does, in one short line. */
  effect: string;
}

export const ITEMS = {
  coffee: { name: 'Чаша кафе', rarity: 'common', kind: 'consumable', target: 'driver', effect: 'Почивката на шофьора, която тече сега, става наполовина.' },
  energy_drink: { name: 'Енергийна напитка', rarity: 'uncommon', kind: 'consumable', target: 'driver', effect: 'Шофьорът е отпочинал веднага.' },
  thermos: { name: 'Термос с кафе', rarity: 'rare', kind: 'consumable', target: 'none', effect: 'Почивката на всички шофьори, която тече сега, става наполовина.' },
  cab_coffee: { name: 'Кафемашина за кабината', rarity: 'legendary', kind: 'consumable', target: 'driver', effect: '24 часа шофьорът не спира за почивка след курс.' },
  power_nap: { name: 'Възглавница за кабина', rarity: 'epic', kind: 'consumable', target: 'driver', effect: '6 часа шофьорът не спира за почивка след курс.' },
  repair_kit: { name: 'Ремонтен комплект', rarity: 'common', kind: 'consumable', target: 'vehicle', effect: '+20% състояние на камиона.' },
  fuel_voucher: { name: 'Ваучер за гориво', rarity: 'common', kind: 'consumable', target: 'none', effect: '+150 лв. по сметката.' },
  cargo_cover: { name: 'Застраховка за един курс', rarity: 'uncommon', kind: 'consumable', target: 'none', effect: 'Следващата неустойка за закъснение се връща изцяло.' },
  queue_ticket: { name: 'Билет за опашката', rarity: 'uncommon', kind: 'consumable', target: 'none', effect: '24 часа +2 места в опашката на всеки камион.' },
  driver_handbook: { name: 'Наръчник на шофьора', rarity: 'rare', kind: 'consumable', target: 'none', effect: '1 час двоен опит.' },
  coin_pouch: { name: 'Кесия с ТрансКоин', rarity: 'rare', kind: 'consumable', target: 'none', effect: '+15 ТрансКоин.' },
  trucker_cap: { name: 'Шофьорска шапка', rarity: 'uncommon', kind: 'cosmetic', target: 'driver', effect: 'Шапка на портрета на шофьора.' },
  sunglasses: { name: 'Слънчеви очила', rarity: 'rare', kind: 'cosmetic', target: 'driver', effect: 'Очила на портрета на шофьора.' },
  gold_frame: { name: 'Златна рамка', rarity: 'epic', kind: 'cosmetic', target: 'driver', effect: 'Златна рамка около портрета.' },
  old_tachograph: { name: 'Стар тахограф диск', rarity: 'uncommon', kind: 'collectible', target: 'none', effect: 'За колекцията „Спомени от пътя“.' },
  truck_keychain: { name: 'Ключодържател камионче', rarity: 'uncommon', kind: 'collectible', target: 'none', effect: 'За колекцията „Спомени от пътя“.' },
  road_atlas: { name: 'Стар пътен атлас', rarity: 'rare', kind: 'collectible', target: 'none', effect: 'За колекцията „Спомени от пътя“.' },
  cb_mic: { name: 'CB микрофон', rarity: 'rare', kind: 'collectible', target: 'none', effect: 'За колекцията „Спомени от пътя“.' },
  case_bronze: { name: 'Бронзов кейс', rarity: 'common', kind: 'case', target: 'none', effect: 'Отвори го за един предмет.' },
  case_silver: { name: 'Сребърен кейс', rarity: 'rare', kind: 'case', target: 'none', effect: 'Отвори го за един предмет.' },
  case_gold: { name: 'Златен кейс', rarity: 'epic', kind: 'case', target: 'none', effect: 'Отвори го за един предмет.' },
} as const satisfies Record<string, ItemDef>;
export type ItemId = keyof typeof ITEMS;
export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
export type CaseId = 'case_bronze' | 'case_silver' | 'case_gold';

/** The contents of each case, with weights (shown as percent in the game). */
export const CASE_TABLES: Record<CaseId, [ItemId, number][]> = {
  case_bronze: [['coffee', 30], ['repair_kit', 24], ['fuel_voucher', 24], ['energy_drink', 10], ['cargo_cover', 7], ['trucker_cap', 3], ['old_tachograph', 2]],
  case_silver: [['coffee', 12], ['energy_drink', 18], ['repair_kit', 12], ['cargo_cover', 14], ['queue_ticket', 10], ['thermos', 10], ['trucker_cap', 8], ['truck_keychain', 6], ['old_tachograph', 6], ['sunglasses', 4]],
  case_gold: [['thermos', 18], ['driver_handbook', 18], ['coin_pouch', 15], ['sunglasses', 12], ['power_nap', 10], ['road_atlas', 9], ['cb_mic', 9], ['gold_frame', 5], ['cab_coffee', 4]],
};

/** A small find on the road after a delivery. */
export const ROAD_FIND = { chance: 0.03, table: [['coffee', 30], ['repair_kit', 20], ['fuel_voucher', 20], ['energy_drink', 12], ['old_tachograph', 8], ['truck_keychain', 6], ['case_bronze', 4]] as [ItemId, number][] };

/** The collection: all four make the badge and ТрансКоин (once). */
export const COLLECTION = { items: ['old_tachograph', 'truck_keychain', 'road_atlas', 'cb_mic'] as ItemId[], badge: 'road-memories', coins: 50 };

export const ITEM_RULES = {
  fuelVoucherCents: 150_00,
  repairPoints: 20,
  coinPouch: 15,
  queueExtra: 2,
  queueHours: 24,
  handbookHours: 1,
  powerNapHours: 6,
  cabCoffeeHours: 24,
  /** A daily reward: on the 7th day of the cycle a silver case, otherwise this chance of a bronze one. */
  dailyBronzeChance: 0.2,
};

export const isCase = (id: ItemId): id is CaseId => ITEMS[id].kind === 'case';

/** Percent chance of each item in a case. */
export function caseOdds(id: CaseId): { item: ItemId; percent: number }[] {
  const table = CASE_TABLES[id];
  const total = table.reduce((s, [, w]) => s + w, 0);
  return table.map(([item, w]) => ({ item, percent: Math.round((w / total) * 1000) / 10 }));
}

/** A weighted pick from a table with a number in [0, 1). */
export function pickFrom(table: readonly [ItemId, number][], r: number): ItemId {
  const total = table.reduce((s, [, w]) => s + w, 0);
  let x = r * total;
  for (const [item, w] of table) {
    if (x < w) return item;
    x -= w;
  }
  return table.at(-1)![0];
}

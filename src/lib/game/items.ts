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
  kind: 'consumable' | 'cosmetic' | 'collectible' | 'case' | 'coins';
  /** Kind 'coins' (1.2): ТрансКоин credited at once when the case drops it — never kept in the inventory. */
  coins?: number;
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
  tc_small: { name: 'Шепа ТрансКоин', rarity: 'uncommon', kind: 'coins', target: 'none', coins: 5, effect: '+5 ТрансКоин веднага.' },
  tc_medium: { name: 'Торба ТрансКоин', rarity: 'epic', kind: 'coins', target: 'none', coins: 25, effect: '+25 ТрансКоин веднага.' },
  tc_jackpot: { name: 'Джакпот ТрансКоин', rarity: 'legendary', kind: 'coins', target: 'none', coins: 100, effect: '+100 ТрансКоин веднага.' },
  case_bronze: { name: 'Бронзов кейс', rarity: 'common', kind: 'case', target: 'none', effect: 'Отвори го за един предмет.' },
  case_silver: { name: 'Сребърен кейс', rarity: 'rare', kind: 'case', target: 'none', effect: 'Отвори го за един предмет.' },
  case_gold: { name: 'Златен кейс', rarity: 'epic', kind: 'case', target: 'none', effect: 'Отвори го за един предмет.' },
  // 1.2.1: the treasure map, the numbered key and the new collections.
  treasure_map: { name: 'Карта на съкровището', rarity: 'rare', kind: 'consumable', target: 'none', effect: 'Показва град: доставка там до 48 часа носи сребърен или златен кейс.' },
  golden_key: { name: 'Златен ключ', rarity: 'legendary', kind: 'collectible', target: 'none', effect: 'Само 50 в цялата игра — всеки с номер.' },
  snow_chains: { name: 'Вериги за сняг', rarity: 'rare', kind: 'collectible', target: 'none', effect: 'За колекцията „Зима на пътя“.' },
  ice_scraper: { name: 'Стъргалка за лед', rarity: 'uncommon', kind: 'collectible', target: 'none', effect: 'За колекцията „Зима на пътя“.' },
  wool_gloves: { name: 'Вълнени ръкавици', rarity: 'uncommon', kind: 'collectible', target: 'none', effect: 'За колекцията „Зима на пътя“.' },
  antifreeze: { name: 'Туба антифриз', rarity: 'common', kind: 'collectible', target: 'none', effect: 'За колекцията „Зима на пътя“.' },
  souvenir_de: { name: 'Магнит от Германия', rarity: 'uncommon', kind: 'collectible', target: 'none', effect: 'За колекцията „Сувенири от Европа“.' },
  souvenir_fr: { name: 'Магнит от Франция', rarity: 'uncommon', kind: 'collectible', target: 'none', effect: 'За колекцията „Сувенири от Европа“.' },
  souvenir_it: { name: 'Магнит от Италия', rarity: 'uncommon', kind: 'collectible', target: 'none', effect: 'За колекцията „Сувенири от Европа“.' },
  souvenir_es: { name: 'Магнит от Испания', rarity: 'rare', kind: 'collectible', target: 'none', effect: 'За колекцията „Сувенири от Европа“.' },
  souvenir_gr: { name: 'Магнит от Гърция', rarity: 'common', kind: 'collectible', target: 'none', effect: 'За колекцията „Сувенири от Европа“.' },
  souvenir_ro: { name: 'Магнит от Румъния', rarity: 'common', kind: 'collectible', target: 'none', effect: 'За колекцията „Сувенири от Европа“.' },
  xmas_ornament: { name: 'Коледна топка', rarity: 'common', kind: 'collectible', target: 'none', effect: 'За колекцията „Коледа в кабината“.' },
  gingerbread_truck: { name: 'Меденка камионче', rarity: 'uncommon', kind: 'collectible', target: 'none', effect: 'За колекцията „Коледа в кабината“.' },
  xmas_lights: { name: 'Лампички за кабината', rarity: 'rare', kind: 'collectible', target: 'none', effect: 'За колекцията „Коледа в кабината“.' },
  santa_hat: { name: 'Коледна шапка', rarity: 'epic', kind: 'collectible', target: 'none', effect: 'За колекцията „Коледа в кабината“.' },
  frost_frame: { name: 'Ледена рамка', rarity: 'epic', kind: 'cosmetic', target: 'driver', effect: 'Ледена рамка около портрета.' },
  euro_frame: { name: 'Рамка „Европа“', rarity: 'epic', kind: 'cosmetic', target: 'driver', effect: 'Синя рамка със звезди около портрета.' },
  xmas_frame: { name: 'Коледна рамка', rarity: 'epic', kind: 'cosmetic', target: 'driver', effect: 'Червено-зелена рамка около портрета.' },
} as const satisfies Record<string, ItemDef>;
export type ItemId = keyof typeof ITEMS;
export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
export type CaseId = 'case_bronze' | 'case_silver' | 'case_gold';

/** The contents of each case, with weights (shown as percent in the game). */
export const CASE_TABLES: Record<CaseId, [ItemId, number][]> = {
  case_bronze: [['coffee', 28], ['repair_kit', 22], ['fuel_voucher', 22], ['energy_drink', 10], ['tc_small', 8], ['cargo_cover', 7], ['trucker_cap', 3], ['old_tachograph', 2]],
  case_silver: [['coffee', 10], ['energy_drink', 16], ['repair_kit', 10], ['cargo_cover', 12], ['queue_ticket', 10], ['thermos', 9], ['tc_small', 10], ['trucker_cap', 7], ['truck_keychain', 6], ['old_tachograph', 6], ['sunglasses', 3], ['tc_medium', 1]],
  case_gold: [['thermos', 16], ['driver_handbook', 16], ['coin_pouch', 12], ['tc_medium', 10], ['sunglasses', 11], ['power_nap', 9], ['road_atlas', 8], ['cb_mic', 8], ['gold_frame', 5], ['cab_coffee', 3], ['tc_jackpot', 2]],
};

/** A small find on the road after a delivery. */
export const ROAD_FIND = { chance: 0.03, table: [['coffee', 30], ['repair_kit', 20], ['fuel_voucher', 20], ['energy_drink', 12], ['old_tachograph', 8], ['truck_keychain', 6], ['case_bronze', 4]] as [ItemId, number][] };

/** The collection: all four make the badge and ТрансКоин (once). */
export const COLLECTION = { items: ['old_tachograph', 'truck_keychain', 'road_atlas', 'cb_mic'] as ItemId[], badge: 'road-memories', coins: 50 };

/**
 * 1.2.1 „Албум“: every collection. All of its items ever found make the reward
 * (once): a badge, ТрансКоин and, for the new ones, a portrait frame. A seasonal
 * collection drops only inside its window (MM-DD, Sofia, inclusive; may wrap).
 */
export interface CollectionDef {
  id: string;
  name: string;
  items: ItemId[];
  badge: string;
  coins: number;
  frame?: ItemId;
  /** Where its items come from, in one line. */
  source: string;
  season?: { from: string; to: string };
}
export const COLLECTIONS: CollectionDef[] = [
  { id: 'road', name: 'Спомени от пътя', items: COLLECTION.items, badge: COLLECTION.badge, coins: COLLECTION.coins, source: 'Кейсове и находки по пътя.' },
  { id: 'winter', name: 'Зима на пътя', items: ['antifreeze', 'ice_scraper', 'wool_gloves', 'snow_chains'], badge: 'winter-road', coins: 60, frame: 'frost_frame', source: 'Находки след доставка от 1 декември до 15 март.', season: { from: '12-01', to: '03-15' } },
  { id: 'euro', name: 'Сувенири от Европа', items: ['souvenir_gr', 'souvenir_ro', 'souvenir_de', 'souvenir_fr', 'souvenir_it', 'souvenir_es'], badge: 'euro-souvenirs', coins: 80, frame: 'euro_frame', source: 'Доставка в съответната държава (шанс при всяка).' },
  { id: 'xmas', name: 'Коледа в кабината', items: ['xmas_ornament', 'gingerbread_truck', 'xmas_lights', 'santa_hat'], badge: 'xmas-cab', coins: 70, frame: 'xmas_frame', source: 'Находки след доставка от 15 декември до 6 януари.', season: { from: '12-15', to: '01-06' } },
];

/** Seasonal finds after a delivery (on top of the usual road find), inside the window. */
export const SEASON_FIND = {
  winter: { chance: 0.05, table: [['antifreeze', 40], ['ice_scraper', 25], ['wool_gloves', 25], ['snow_chains', 10]] as [ItemId, number][] },
  xmas: { chance: 0.07, table: [['xmas_ornament', 40], ['gingerbread_truck', 30], ['xmas_lights', 20], ['santa_hat', 10]] as [ItemId, number][] },
};

/** A souvenir now and then when a delivery ends in its country. */
export const SOUVENIRS: { country: string; name: string; item: ItemId; chance: number }[] = [
  { country: 'DE', name: 'Германия', item: 'souvenir_de', chance: 0.06 },
  { country: 'FR', name: 'Франция', item: 'souvenir_fr', chance: 0.06 },
  { country: 'IT', name: 'Италия', item: 'souvenir_it', chance: 0.06 },
  { country: 'ES', name: 'Испания', item: 'souvenir_es', chance: 0.05 },
  { country: 'GR', name: 'Гърция', item: 'souvenir_gr', chance: 0.06 },
  { country: 'RO', name: 'Румъния', item: 'souvenir_ro', chance: 0.06 },
];

/** 1.2.1: the numbered golden key — a chance in a gold case while numbers are left. */
export const GOLDEN_KEY = { total: 50, goldCaseChance: 0.005 };

/** 1.2.1: the treasure map — a delivery to the city within the hours gives a case (gold with this chance). */
export const TREASURE = { hours: 48, goldChance: 0.25, findChance: 0.01 };

/** 1.2.1: ТрансКоин for an item sold (by rarity) and the most a player gets from sales a day. */
export const SELL_PRICE: Record<Rarity, number> = { common: 2, uncommon: 4, rare: 8, epic: 15, legendary: 30 };
export const SELL_DAY_CAP = 50;

/** 1.2.1: trades between players — from this level, never with an account of the same network. */
export const TRADE_RULES = { minLevel: 5, openMax: 5, noteMax: 120 };

/** Items that stay with the one who found them (no sale, gift or trade). */
export const BOUND_ITEMS: ItemId[] = ['golden_key'];

/** 1.2.1 „Работилница“: three of a kind make one of the next rarity; recipes make a set item. */
export const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
export const CRAFT_SAME = 3;
export interface Recipe {
  id: string;
  /** Item → how many (the order does not matter). */
  needs: Partial<Record<ItemId, number>>;
  makes: ItemId;
  /** A hint for a recipe not found yet. */
  hint: string;
}
export const RECIPES: Recipe[] = [
  { id: 'cab_coffee', needs: { coffee: 2, thermos: 1 }, makes: 'cab_coffee', hint: 'Кафе, много кафе… и нещо да го пази топло.' },
  { id: 'power_nap', needs: { energy_drink: 2, coffee: 1 }, makes: 'power_nap', hint: 'Две енергийни и едно кафе — после сън.' },
  { id: 'queue_ticket', needs: { cargo_cover: 1, fuel_voucher: 2 }, makes: 'queue_ticket', hint: 'Застраховка и малко гориво — и си напред в опашката.' },
  { id: 'treasure_map', needs: { road_atlas: 1, fuel_voucher: 2 }, makes: 'treasure_map', hint: 'Стар атлас и гориво за път.' },
  { id: 'gold_frame', needs: { trucker_cap: 1, sunglasses: 1, coin_pouch: 1 }, makes: 'gold_frame', hint: 'Шапка, очила и малко злато.' },
  { id: 'driver_handbook', needs: { old_tachograph: 2, coffee: 1 }, makes: 'driver_handbook', hint: 'Стари записи и кафе — уроци за шофьора.' },
];

/** What „три еднакви“ can turn into: items of the next rarity (no coins, cases, seasonal or bound ones). */
export function craftPool(rarity: Rarity): ItemId[] {
  const seasonal = new Set(COLLECTIONS.filter((c) => c.id !== 'road').flatMap((c) => [...c.items, ...(c.frame ? [c.frame] : [])]));
  return ITEM_IDS.filter((id) => ITEMS[id].rarity === rarity && ['consumable', 'cosmetic', 'collectible'].includes(ITEMS[id].kind) && !seasonal.has(id) && !BOUND_ITEMS.includes(id));
}

/** What three of `id` make: the next case up, or a random item of the next rarity (null when there is none). */
export function craftUp(id: ItemId): { kind: 'case'; item: ItemId } | { kind: 'pool'; rarity: Rarity; pool: ItemId[] } | null {
  if (id === 'case_bronze') return { kind: 'case', item: 'case_silver' };
  if (id === 'case_silver') return { kind: 'case', item: 'case_gold' };
  const def = ITEMS[id] as ItemDef;
  if (def.kind === 'case' || def.kind === 'coins' || BOUND_ITEMS.includes(id)) return null;
  const next = RARITY_ORDER[RARITY_ORDER.indexOf(def.rarity) + 1];
  if (!next) return null;
  const pool = craftPool(next);
  return pool.length ? { kind: 'pool', rarity: next, pool } : null;
}

/** The recipe matching exactly these items (a multiset), if any. */
export function matchRecipe(items: ItemId[]): Recipe | null {
  const count = (list: ItemId[]) => list.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
  const have = count(items);
  return RECIPES.find((r) => {
    const need = r.needs as Record<string, number>;
    const keys = Object.keys(need);
    return keys.length === Object.keys(have).length && keys.every((k) => have[k] === need[k]);
  }) ?? null;
}

/**
 * 1.2.1.1: items received from another player (a present, a trade) are not „found“:
 * they do not fill the album or a collection — otherwise one item passed from
 * friend to friend would complete everyone's collection.
 */
export const RECEIVED_REASONS = ['gift_in', 'trade_in'];

/** Can the item be sold, given or traded? */
export const tradable = (id: ItemId) => !BOUND_ITEMS.includes(id) && ITEMS[id].kind !== 'coins';

/** The collection an item belongs to (or that gives it as a reward). */
export const collectionOf = (id: ItemId) => COLLECTIONS.find((c) => c.items.includes(id));

/** Where an item can be found, with the chance (for the item card). Game data. */
export function sourcesOf(id: ItemId): { source: string; arg?: string; percent: number | null }[] {
  const out: { source: string; arg?: string; percent: number | null }[] = [];
  for (const c of ['case_bronze', 'case_silver', 'case_gold'] as CaseId[]) {
    const o = caseOdds(c).find((x) => x.item === id);
    if (o) out.push({ source: ITEMS[c].name, percent: o.percent });
  }
  const pct = (table: [ItemId, number][], chance: number) => {
    const total = table.reduce((s, [, w]) => s + w, 0);
    const w = table.find(([x]) => x === id)?.[1];
    return w ? Math.round(((w / total) * chance) * 10000) / 100 : null;
  };
  const road = pct(ROAD_FIND.table, ROAD_FIND.chance);
  if (road) out.push({ source: 'Находка след доставка', percent: road });
  const winter = pct(SEASON_FIND.winter.table, SEASON_FIND.winter.chance);
  if (winter) out.push({ source: 'Зимна находка след доставка (1.12 – 15.03)', percent: winter });
  const xmas = pct(SEASON_FIND.xmas.table, SEASON_FIND.xmas.chance);
  if (xmas) out.push({ source: 'Коледна находка след доставка (15.12 – 6.01)', percent: xmas });
  const souvenir = SOUVENIRS.find((s) => s.item === id);
  if (souvenir) out.push({ source: 'Доставка в {0}', arg: souvenir.name, percent: souvenir.chance * 100 });
  if (id === 'treasure_map') out.push({ source: 'Находка след доставка', percent: TREASURE.findChance * 100 });
  if (id === 'golden_key') out.push({ source: ITEMS.case_gold.name, percent: GOLDEN_KEY.goldCaseChance * 100 });
  for (const r of RECIPES) if (r.makes === id) out.push({ source: 'Работилница (рецепта)', percent: null });
  const frameOf = COLLECTIONS.find((c) => c.frame === id);
  if (frameOf) out.push({ source: 'Награда за колекцията „{0}“', arg: frameOf.name, percent: null });
  return out;
}

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

/** 1.2.1: the portrait frames and the item each one comes from. */
export type FrameId = 'gold' | 'frost' | 'euro' | 'xmas';
export type DriverLook = { cap?: boolean; glasses?: boolean; frame?: FrameId };
export const FRAME_ITEMS: Record<FrameId, ItemId> = { gold: 'gold_frame', frost: 'frost_frame', euro: 'euro_frame', xmas: 'xmas_frame' };
export const FRAME_COLORS: Record<FrameId, string[]> = { gold: ['#facc15'], frost: ['#7dd3fc', '#e0f2fe'], euro: ['#1d4ed8', '#facc15'], xmas: ['#dc2626', '#16a34a'] };
/** The look part a cosmetic item sets. */
export function lookPart(id: ItemId): { part: 'cap' } | { part: 'glasses' } | { part: 'frame'; frame: FrameId } | null {
  if (id === 'trucker_cap') return { part: 'cap' };
  if (id === 'sunglasses') return { part: 'glasses' };
  const f = (Object.keys(FRAME_ITEMS) as FrameId[]).find((k) => FRAME_ITEMS[k] === id);
  return f ? { part: 'frame', frame: f } : null;
}

export const isCase = (id: ItemId): id is CaseId => ITEMS[id].kind === 'case';

/** ТрансКоин a case drop is worth (0 for a normal item). */
export const coinsOf = (id: ItemId): number => (ITEMS[id] as ItemDef).coins ?? 0;

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

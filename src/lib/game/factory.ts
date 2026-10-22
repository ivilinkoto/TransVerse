import type { CargoType } from './cargo';

/**
 * The factory on the company plot (v1.4): the company picks what it makes,
 * the members haul the raw materials from real supplier cities, a batch
 * takes a few hours, and the members haul the product to a buyer city — the
 * sale goes into the treasury. Recipes, prices and times are game data.
 */

export const RAW = {
  timber: { label: 'Дървен материал', goods: 'Дървен материал', cargo: 'pallets' as CargoType, priceCents: 160_00 },
  flour: { label: 'Брашно', goods: 'Брашно на палети', cargo: 'pallets' as CargoType, priceCents: 140_00 },
  gravel: { label: 'Чакъл', goods: 'Чакъл и пясък', cargo: 'bulk' as CargoType, priceCents: 45_00 },
  cement: { label: 'Цимент', goods: 'Цимент на палети', cargo: 'pallets' as CargoType, priceCents: 180_00 },
  steel: { label: 'Стомана', goods: 'Стоманени профили', cargo: 'steel' as CargoType, priceCents: 900_00 },
  fruit: { label: 'Плодове', goods: 'Пресни плодове', cargo: 'refrigerated' as CargoType, priceCents: 260_00 },
} as const;
export type RawId = keyof typeof RAW;
export type RawStock = Partial<Record<RawId, number>>;

export interface Recipe {
  id: string;
  label: string;
  /** Tonnes of each raw material a batch takes. */
  inputs: RawStock;
  /** What a batch makes. */
  output: { goods: string; cargo: CargoType; tons: number; priceCentsPerTon: number };
  hours: number;
}

export const RECIPES: Recipe[] = [
  { id: 'furniture', label: 'Мебели', inputs: { timber: 8 }, output: { goods: 'Мебели', cargo: 'pallets', tons: 6, priceCentsPerTon: 560_00 }, hours: 6 },
  { id: 'bakery', label: 'Хляб и тестени', inputs: { flour: 6 }, output: { goods: 'Хляб и тестени изделия', cargo: 'refrigerated', tons: 6, priceCentsPerTon: 420_00 }, hours: 3 },
  { id: 'concrete', label: 'Бетонови елементи', inputs: { cement: 6, gravel: 12 }, output: { goods: 'Бетонови елементи', cargo: 'bulk', tons: 16, priceCentsPerTon: 210_00 }, hours: 5 },
  { id: 'metalwork', label: 'Метални конструкции', inputs: { steel: 8 }, output: { goods: 'Метални конструкции', cargo: 'steel', tons: 7, priceCentsPerTon: 1_650_00 }, hours: 8 },
  { id: 'juice', label: 'Сокове', inputs: { fruit: 7 }, output: { goods: 'Плодови сокове', cargo: 'pallets', tons: 6, priceCentsPerTon: 520_00 }, hours: 4 },
];

export const recipeOf = (id: string | null | undefined) => RECIPES.find((r) => r.id === id) ?? null;

export const FACTORY = {
  /** One raw load at most (tonnes). */
  loadTons: 7,
  bulkLoadTons: 20,
  /** Raw and product loads stay on the members' board this long. */
  loadHours: 72,
  /** Batches a raw order can be for. */
  maxBatches: 5,
  /** Buyers: real cities this far from the base at most. */
  buyerMaxKm: 700,
} as const;

/** A batch takes less time and makes more with the factory level. */
export const batchHours = (r: Recipe, level: number) => r.hours / (1 + 0.5 * (Math.max(1, level) - 1));
export const batchTons = (r: Recipe, level: number) => Math.round(r.output.tons * (1 + 0.25 * (Math.max(1, level) - 1)) * 10) / 10;

/** What the raw materials for `batches` batches cost. */
export const rawCostCents = (r: Recipe, batches: number) => Object.entries(r.inputs).reduce((sum, [id, t]) => sum + RAW[id as RawId].priceCents * (t ?? 0) * batches, 0);

/** Can the stock make one batch? */
export const canMake = (r: Recipe, stock: RawStock) => Object.entries(r.inputs).every(([id, t]) => (stock[id as RawId] ?? 0) + 1e-9 >= (t ?? 0));

/** Loads of at most `max` t for an amount. */
export function loadsOf(tons: number, max: number): number[] {
  const out: number[] = [];
  let left = Math.round(tons * 10) / 10;
  while (left > 1e-9) {
    const t = Math.min(max, left);
    out.push(Math.round(t * 10) / 10);
    left = Math.round((left - t) * 10) / 10;
  }
  return out;
}

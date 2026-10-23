/**
 * The trucks' heritage (v1.6), game data:
 * - Legendary truck: at 100 000, 250 000 and 500 000 km on the odometer a
 *   truck becomes a legend (bronze, silver, gold) — a title on the truck and
 *   ТрансКоин for its owner, once per truck and tier.
 * - Scrap: an own idle truck goes to the scrapyard for a tenth of its new
 *   price and spare parts (more for a bigger truck); a spare part repairs
 *   another truck by a quarter at no cost.
 * - The company museum (a plot building): members donate trucks with a long
 *   life behind them; they stay on show for good.
 */
export const LEGEND = [
  { km: 100_000, title: 'Бронзова легенда', short: 'бронз', coins: 50 },
  { km: 250_000, title: 'Сребърна легенда', short: 'сребро', coins: 100 },
  { km: 500_000, title: 'Златна легенда', short: 'злато', coins: 250 },
] as const;

export const LEGEND_BADGE = 'legendary-truck';

/** The legend tier of an odometer reading (0 = none, 1–3). */
export const legendTier = (km: number) => LEGEND.filter((t) => km >= t.km).length;

/** The tiers crossed between two odometer readings. */
export const legendTiersCrossed = (before: number, after: number) => LEGEND.map((t, i) => ({ ...t, tier: i + 1 })).filter((t) => before < t.km && after >= t.km);

export const SCRAP = {
  share: 0.1,
  /** Spare parts by kind of power unit. */
  parts: { tractor: 3, rigid: 2, van: 1 } as Record<string, number>,
  repairPerPart: 25,
} as const;

export const MUSEUM = {
  /** Exhibits by museum level (index = level). */
  capacity: [0, 3, 6, 10],
  minKm: 50_000,
  coins: 25,
  /** A legend brings its donor more. */
  legendCoins: 50,
} as const;

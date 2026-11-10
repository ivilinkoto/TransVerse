/**
 * 1.3 „Собствен сервиз“: a player opens a workshop in a city and sets its price
 * (60–120 % of the usual repair). Other players repair there trucks that stand in
 * that city; the owner gets a share of what they pay (the rest is parts and
 * materials, it leaves the economy). Upgrades raise the owner's share. Game data.
 */
export const WORKSHOP = {
  minLevel: 10,
  openCents: 50_000_00,
  price: { min: 60, max: 120, start: 90 },
  /** The owner's share of a repair by workshop level, and the cost of the next level. */
  levels: [
    { share: 0.8, upgradeCents: 30_000_00 },
    { share: 0.85, upgradeCents: 60_000_00 },
    { share: 0.9, upgradeCents: 0 },
  ],
  nameMax: 28,
} as const;

export interface WorkshopState {
  ownerId: string;
  name: string;
  cityId: number;
  city: string;
  country: string;
  pricePct: number;
  level: number;
  repairs: number;
  earnedCents: number;
  ratingSum: number;
  ratingCount: number;
  openedAt: string;
}

export const ownerShare = (level: number) => WORKSHOP.levels[Math.max(0, Math.min(WORKSHOP.levels.length - 1, level - 1))]!.share;
export const rating = (w: Pick<WorkshopState, 'ratingSum' | 'ratingCount'>) => (w.ratingCount ? Math.round((w.ratingSum / w.ratingCount) * 10) / 10 : null);

export function cleanWorkshopName(raw: string): string | null {
  const name = [...raw.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, WORKSHOP.nameMax).join('').trim();
  return name.length >= 3 ? name : null;
}

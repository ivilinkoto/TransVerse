/**
 * 1.2.3.5 „Гараж“: the player's own trucks in a 3D hall. Tuning parts are looks only
 * (no effect on the game) and are paid in лв. Each style bought stays with the truck,
 * so a saved set can be put back on for free. Upgrades that change the numbers
 * (fuel, wear, XP) stay in `UPGRADES`.
 */
import type { PowerUnitKind } from './catalog';

export type TuningPart = 'spoiler' | 'skirts' | 'bullbar' | 'exhaust' | 'rims' | 'stance' | 'decal';

export interface TuningStyle {
  id: string;
  label: string;
  priceCents: number;
}

export interface TuningPartDef {
  label: string;
  styles: TuningStyle[];
  /** Vehicle kinds the part fits on. */
  kinds: PowerUnitKind[];
}

export type Tuning = Partial<Record<TuningPart, string>>;

export const TUNING_PARTS: Record<TuningPart, TuningPartDef> = {
  spoiler: { label: 'Спойлер на покрива', kinds: ['rigid', 'tractor'], styles: [{ id: 'low', label: 'Нисък', priceCents: 1_200_00 }, { id: 'high', label: 'Висок', priceCents: 1_800_00 }] },
  skirts: { label: 'Странични поли', kinds: ['rigid', 'tractor'], styles: [{ id: 'body', label: 'В цвета', priceCents: 1_500_00 }, { id: 'black', label: 'Черни', priceCents: 1_500_00 }, { id: 'chrome', label: 'Хромирани', priceCents: 2_400_00 }] },
  bullbar: { label: 'Предна броня (бикбар)', kinds: ['van', 'rigid', 'tractor'], styles: [{ id: 'chrome', label: 'Хром', priceCents: 2_200_00 }, { id: 'black', label: 'Черна', priceCents: 1_800_00 }] },
  exhaust: { label: 'Ауспуси', kinds: ['rigid', 'tractor'], styles: [{ id: 'single', label: 'Един хромиран', priceCents: 900_00 }, { id: 'twin', label: 'Два хромирани', priceCents: 1_600_00 }] },
  rims: { label: 'Джанти', kinds: ['van', 'rigid', 'tractor'], styles: [{ id: 'alloy', label: 'Алуминиеви', priceCents: 1_400_00 }, { id: 'chrome', label: 'Хромирани', priceCents: 2_600_00 }, { id: 'black', label: 'Черни', priceCents: 1_800_00 }] },
  stance: { label: 'Височина', kinds: ['van', 'rigid', 'tractor'], styles: [{ id: 'low', label: 'Нисък', priceCents: 2_000_00 }, { id: 'high', label: 'Висок', priceCents: 2_000_00 }] },
  decal: { label: 'Стикери по кабината', kinds: ['van', 'rigid', 'tractor'], styles: [{ id: 'flame', label: 'Пламъци', priceCents: 1_100_00 }, { id: 'racing', label: 'Състезателни ленти', priceCents: 1_100_00 }, { id: 'stars', label: 'Звезди', priceCents: 1_100_00 }] },
};

export const TUNING_IDS = Object.keys(TUNING_PARTS) as TuningPart[];

export const GARAGE = {
  /** Saved tuning sets per truck. */
  presets: 3,
  presetName: 20,
  /** A note left in a friend's garage. */
  noteChars: 120,
  /** Showing the garage in the global chat: once in this many hours. */
  shareEveryHours: 6,
  /** Old trucks on the shelf of the retro corner. */
  retroShelf: 8,
} as const;

export const tuningStyle = (part: TuningPart, style: string) => TUNING_PARTS[part]?.styles.find((s) => s.id === style);
export const fitsKind = (part: TuningPart, kind: PowerUnitKind) => TUNING_PARTS[part].kinds.includes(kind);
export const ownedKey = (part: TuningPart, style: string) => `${part}:${style}`;

/** The hall grows with the player: a small workshop, a hall, then a modern hall with LED walls. */
export const HALL_TIERS = [
  { tier: 1, minLevel: 1, label: 'Малък сервиз', platforms: 1 },
  { tier: 2, minLevel: 5, label: 'Хале', platforms: 2 },
  { tier: 3, minLevel: 10, label: 'Модерно хале', platforms: 3 },
] as const;

export function hallTier(level: number) {
  return [...HALL_TIERS].reverse().find((h) => level >= h.minLevel) ?? HALL_TIERS[0];
}

/** Day or night in the hall by the real hour (Bulgarian time). */
export function hallIsNight(now: Date): boolean {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Europe/Sofia' }).format(now)) % 24;
  return h >= 19 || h < 7;
}

/**
 * The truck's numbers on 0–100 bars, from its upgrades (what the game really uses):
 * economy (fuel), durability (wear), comfort (XP) and winter grip.
 */
export function truckStats(upgrades: readonly string[], defs: Record<string, { fuel: number; wear: number; xp: number }>) {
  let fuel = 1;
  let wear = 1;
  let xp = 1;
  for (const u of upgrades) {
    const d = defs[u];
    if (!d) continue;
    fuel *= d.fuel;
    wear *= d.wear;
    xp *= d.xp;
  }
  const bar = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
  return {
    economy: bar(50 + (1 - fuel) * 300),
    durability: bar(50 + (1 - wear) * 160),
    comfort: bar(50 + (xp - 1) * 400),
    winter: upgrades.includes('winter_tyres') || upgrades.includes('all_season_tyres') ? 100 : 20,
  };
}

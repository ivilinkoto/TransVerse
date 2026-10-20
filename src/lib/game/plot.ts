/**
 * The company plot (v1.3): every company has a plot in its base city and
 * builds on it — an office first, then a logistics centre, a training centre,
 * a service and a parking. A building (or its next level) needs materials,
 * hauled by the members from real supplier cities (or bought delivered, at a
 * premium), then construction time. A finished building gives its effect
 * through the company's upgrade levels, so the bonuses are the ones the
 * "Развитие" upgrades gave before. Game data.
 */
import { COMPANY_UPGRADES, type UpgradeLevels } from './company';
import type { CargoType } from './cargo';

export const PLOT = {
  /** Grid size in tiles (x to the right-down, y to the left-down on screen). */
  w: 14,
  h: 12,
  /** The driveway from the gate (front edge) to the yard: tiles that stay free. */
  driveway: { x: 6, yFrom: 5 },
  yardY: 5,
  /** Buying the missing materials delivered costs this much more. */
  deliveredMarkup: 1.5,
  /** One material load at most (tonnes), so rigid trucks can carry them. */
  loadTons: { pallets: 7, steel: 20 } as Record<string, number>,
  /** Material loads stay on the members' board this long. */
  loadHours: 72,
} as const;

export const MATERIALS = {
  cement: { label: 'Цимент', goods: 'Цимент на палети', cargo: 'pallets' as CargoType, priceCents: 180_00 },
  bricks: { label: 'Тухли', goods: 'Тухли и блокове', cargo: 'pallets' as CargoType, priceCents: 220_00 },
  glass: { label: 'Стъкло', goods: 'Стъклопакети', cargo: 'pallets' as CargoType, priceCents: 600_00 },
  steel: { label: 'Стомана', goods: 'Стоманени греди', cargo: 'steel' as CargoType, priceCents: 900_00 },
} as const;
export type MaterialId = keyof typeof MATERIALS;
export const MATERIAL_IDS = Object.keys(MATERIALS) as MaterialId[];
export type Materials = Partial<Record<MaterialId, number>>;

export type BuildingType = 'office' | 'logistics' | 'training' | 'service' | 'parking';

export interface BuildingDef {
  type: BuildingType;
  label: string;
  /** Footprint in tiles. */
  w: number;
  h: number;
  /** The company upgrade this building drives (its level = building level − offset). */
  upgrade: 'capacity' | 'logistics' | 'training' | 'service' | 'parking';
  offset: number;
  maxLevel: number;
  /** Materials of level 1; later levels need more. */
  base: Materials;
  effect: (level: number) => string;
  /** Company level needed for each level (index = level − 1). */
  minCompanyLevel: number[];
}

const upgradeLevels = (id: string) => COMPANY_UPGRADES.find((u) => u.id === id)?.levels ?? [];

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  office: {
    type: 'office',
    label: 'Офис',
    w: 3,
    h: 3,
    upgrade: 'capacity',
    offset: 1,
    maxLevel: upgradeLevels('capacity').length + 1,
    base: { cement: 14, bricks: 14, glass: 3 },
    effect: (l) => `${5 + 5 * (l - 1)} места за членове`,
    minCompanyLevel: [1, ...upgradeLevels('capacity').map((x) => x.minCompanyLevel)],
  },
  logistics: {
    type: 'logistics',
    label: 'Логистичен център',
    w: 4,
    h: 4,
    upgrade: 'logistics',
    offset: 0,
    maxLevel: upgradeLevels('logistics').length,
    base: { cement: 20, steel: 12, bricks: 10, glass: 2 },
    effect: (l) => `+${l * 2} % заплащане на курсовете на членовете`,
    minCompanyLevel: upgradeLevels('logistics').map((x) => x.minCompanyLevel),
  },
  training: {
    type: 'training',
    label: 'Учебен център',
    w: 3,
    h: 3,
    upgrade: 'training',
    offset: 0,
    maxLevel: upgradeLevels('training').length,
    base: { cement: 12, bricks: 14, glass: 4, steel: 4 },
    effect: (l) => `+${l * 5} % опит от курсовете на членовете`,
    minCompanyLevel: upgradeLevels('training').map((x) => x.minCompanyLevel),
  },
  service: {
    type: 'service',
    label: 'Сервиз',
    w: 3,
    h: 3,
    upgrade: 'service',
    offset: 0,
    maxLevel: 3,
    base: { cement: 14, steel: 8, bricks: 8 },
    effect: (l) => `−${l * 10} % цена на ремонтите за членовете`,
    minCompanyLevel: [2, 4, 6],
  },
  parking: {
    type: 'parking',
    label: 'Паркинг',
    w: 4,
    h: 3,
    upgrade: 'parking',
    offset: 0,
    maxLevel: 3,
    base: { cement: 24, steel: 2 },
    effect: (l) => `+${l} ${l === 1 ? 'място' : 'места'} за камион в депото на всеки член в града на базата`,
    minCompanyLevel: [2, 3, 5],
  },
};
export const BUILDING_TYPES = Object.keys(BUILDINGS) as BuildingType[];

/** How much more each level needs than level 1, and how long it takes (real minutes). */
const LEVEL_FACTOR = [1, 1.8, 3, 4.5, 6.5];
const LEVEL_MINUTES = [180, 360, 600, 960, 1440];

export interface LevelSpec {
  materials: Materials;
  minutes: number;
  minCompanyLevel: number;
}

/** What building (or raising) a building to `level` needs. Steel joins from level 2 for the office. */
export function levelSpec(type: BuildingType, level: number): LevelSpec {
  const def = BUILDINGS[type];
  const f = LEVEL_FACTOR[level - 1] ?? LEVEL_FACTOR.at(-1)!;
  const base: Materials = type === 'office' && level > 1 ? { ...def.base, steel: 6 } : def.base;
  const materials = Object.fromEntries(Object.entries(base).map(([m, t]) => [m, Math.round((t ?? 0) * f)])) as Materials;
  return { materials, minutes: LEVEL_MINUTES[level - 1] ?? LEVEL_MINUTES.at(-1)!, minCompanyLevel: def.minCompanyLevel[level - 1] ?? 1 };
}

/** The purchase price of materials (tonnes × price), optionally with the delivery markup. */
export function materialCostCents(m: Materials, delivered = false): number {
  const sum = MATERIAL_IDS.reduce((s, id) => s + (m[id] ?? 0) * MATERIALS[id].priceCents, 0);
  return Math.round(sum * (delivered ? PLOT.deliveredMarkup : 1));
}

/** Tonnes still missing (needed − delivered − on the way), per material. */
export function missing(need: Materials, delivered: Materials, onTheWay: Materials = {}): Materials {
  const out: Materials = {};
  for (const id of MATERIAL_IDS) {
    const left = (need[id] ?? 0) - (delivered[id] ?? 0) - (onTheWay[id] ?? 0);
    if (left > 0.001) out[id] = Math.round(left * 10) / 10;
  }
  return out;
}

export const isComplete = (need: Materials, delivered: Materials) => Object.keys(missing(need, delivered)).length === 0;

/** Splits tonnes of one material into loads a truck can take. */
export function splitLoads(material: MaterialId, tons: number): number[] {
  const max = PLOT.loadTons[MATERIALS[material].cargo] ?? 10;
  const n = Math.max(1, Math.ceil(tons / max));
  const each = Math.round((tons / n) * 10) / 10;
  return Array.from({ length: n }, (_, i) => (i < n - 1 ? each : Math.round((tons - each * (n - 1)) * 10) / 10));
}

export interface PlacedBuilding {
  type: BuildingType;
  x: number;
  y: number;
}

const isDriveway = (x: number, y: number) => (x === PLOT.driveway.x && y >= PLOT.driveway.yFrom) || (y === PLOT.yardY && x >= PLOT.driveway.x);

/** Why a building cannot stand at (x, y) — off the plot, on the driveway or over another one; null when it can. */
export function placementError(type: BuildingType, x: number, y: number, others: readonly PlacedBuilding[]): string | null {
  const def = BUILDINGS[type];
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x + def.w > PLOT.w || y + def.h > PLOT.h) return 'Сградата излиза извън участъка.';
  for (let i = x; i < x + def.w; i++) for (let j = y; j < y + def.h; j++) if (isDriveway(i, j)) return 'Тук минава пътят към двора.';
  for (const o of others) {
    if (o.type === type) continue;
    const d = BUILDINGS[o.type];
    if (x < o.x + d.w && o.x < x + def.w && y < o.y + d.h && o.y < y + def.h) return `Мястото е заето от „${d.label}“.`;
  }
  return null;
}

/** Where existing companies' buildings go when they get their plot (it all fits next to each other). */
export const DEFAULT_SPOTS: Record<BuildingType, { x: number; y: number }> = {
  office: { x: 1, y: 1 },
  logistics: { x: 8, y: 0 },
  training: { x: 1, y: 7 },
  service: { x: 2, y: 4 },
  parking: { x: 8, y: 7 },
};

/** The upgrade levels a set of finished buildings gives (only the keys they drive). */
export function upgradesFromBuildings(buildings: readonly { type: BuildingType; level: number }[], current: UpgradeLevels): UpgradeLevels {
  const out: UpgradeLevels = { ...current };
  for (const b of buildings) {
    const def = BUILDINGS[b.type];
    out[def.upgrade] = Math.max(0, b.level - def.offset);
  }
  return out;
}

/** The building level matching an existing upgrade level (for converting existing companies). */
export const levelFromUpgrade = (type: BuildingType, upgrades: UpgradeLevels) => {
  const def = BUILDINGS[type];
  const l = (upgrades[def.upgrade] ?? 0) + def.offset;
  return Math.min(def.maxLevel, l);
};

import type { BodyType } from './cargo';

/**
 * Vehicle catalogue. Manufacturers are fictional on purpose (no trademarks);
 * dimensions and figures follow real European vehicle classes.
 */

export type PowerUnitKind = 'van' | 'rigid' | 'tractor';
export type CabStyle = 'van' | 'day' | 'sleeper' | 'highline';

export interface PowerUnitModel {
  id: string;
  kind: PowerUnitKind;
  brand: string;
  name: string;
  priceCents: number;
  /** Payload for vans/rigids (own body). Tractors carry via trailers. */
  payloadTons: number;
  /** Own body for vans/rigids; null for tractors. */
  body: BodyType | null;
  /** Max gross combination weight class: heavy tractors pull lowbeds. */
  heavyHaul: boolean;
  maxSpeedKmh: number;
  /** Litres / 100 km empty and fully loaded. */
  fuelEmpty: number;
  fuelFull: number;
  maintenanceCentsPerKm: number;
  /** Heavy vehicles (> 3.5 t) pay road tolls. */
  tolled: boolean;
  powerHp: number;
  axles: number;
  minLevel: number;
  cab: CabStyle;
}

export interface TrailerModel {
  id: string;
  body: BodyType;
  brand: string;
  name: string;
  priceCents: number;
  payloadTons: number;
  axles: number;
  requiresHeavyHaul: boolean;
  minLevel: number;
  /** Extra fuel litres/100km when hauled loaded. */
  dragFuel: number;
}

export const POWER_UNITS: PowerUnitModel[] = [
  {
    id: 'sokol-courier', kind: 'van', brand: 'Balkan Motors', name: 'Sokol Courier 3.5', priceCents: 34_000_00,
    payloadTons: 1.3, body: 'box', heavyHaul: false, maxSpeedKmh: 110, fuelEmpty: 8.5, fuelFull: 11,
    maintenanceCentsPerKm: 4, tolled: false, powerHp: 170, axles: 2, minLevel: 1, cab: 'van',
  },
  {
    id: 'hemus-r12-box', kind: 'rigid', brand: 'Hemus Trucks', name: 'Hemus R12 Box', priceCents: 79_000_00,
    payloadTons: 7.5, body: 'box', heavyHaul: false, maxSpeedKmh: 90, fuelEmpty: 17, fuelFull: 23,
    maintenanceCentsPerKm: 8, tolled: true, powerHp: 250, axles: 2, minLevel: 1, cab: 'day',
  },
  {
    id: 'hemus-r12-frigo', kind: 'rigid', brand: 'Hemus Trucks', name: 'Hemus R12 Frigo', priceCents: 94_000_00,
    payloadTons: 6.5, body: 'reefer', heavyHaul: false, maxSpeedKmh: 90, fuelEmpty: 19, fuelFull: 25,
    maintenanceCentsPerKm: 9, tolled: true, powerHp: 250, axles: 2, minLevel: 2, cab: 'day',
  },
  {
    id: 'danubia-t440', kind: 'tractor', brand: 'Danubia', name: 'Danubia T440', priceCents: 98_000_00,
    payloadTons: 0, body: null, heavyHaul: false, maxSpeedKmh: 85, fuelEmpty: 22, fuelFull: 31,
    maintenanceCentsPerKm: 10, tolled: true, powerHp: 440, axles: 2, minLevel: 2, cab: 'sleeper',
  },
  {
    id: 'danubia-t500-eco', kind: 'tractor', brand: 'Danubia', name: 'Danubia T500 Eco', priceCents: 124_000_00,
    payloadTons: 0, body: null, heavyHaul: false, maxSpeedKmh: 85, fuelEmpty: 20, fuelFull: 28,
    maintenanceCentsPerKm: 10, tolled: true, powerHp: 500, axles: 2, minLevel: 4, cab: 'highline',
  },
  {
    id: 'rila-xt620', kind: 'tractor', brand: 'Rila Heavy', name: 'Rila XT 620 6×4', priceCents: 168_000_00,
    payloadTons: 0, body: null, heavyHaul: true, maxSpeedKmh: 80, fuelEmpty: 27, fuelFull: 42,
    maintenanceCentsPerKm: 15, tolled: true, powerHp: 620, axles: 3, minLevel: 7, cab: 'highline',
  },
];

export const TRAILERS: TrailerModel[] = [
  { id: 'curtain-13', body: 'curtain', brand: 'Struma Trailers', name: 'Завеса 13.6 м', priceCents: 32_000_00, payloadTons: 24, axles: 3, requiresHeavyHaul: false, minLevel: 2, dragFuel: 0 },
  { id: 'reefer-13', body: 'reefer', brand: 'Struma Trailers', name: 'Хладилно ремарке 13.6 м', priceCents: 58_000_00, payloadTons: 22, axles: 3, requiresHeavyHaul: false, minLevel: 2, dragFuel: 1.5 },
  { id: 'tipper-26', body: 'tipper', brand: 'Iskar Steel', name: 'Самосвал 30 м³', priceCents: 44_000_00, payloadTons: 26, axles: 3, requiresHeavyHaul: false, minLevel: 3, dragFuel: 0.5 },
  { id: 'container-40', body: 'container', brand: 'Iskar Steel', name: 'Контейнерно шаси 40′', priceCents: 29_000_00, payloadTons: 26, axles: 3, requiresHeavyHaul: false, minLevel: 4, dragFuel: 0.5 },
  { id: 'tanker-32', body: 'tanker', brand: 'Iskar Steel', name: 'Цистерна 32 000 л', priceCents: 69_000_00, payloadTons: 25, axles: 3, requiresHeavyHaul: false, minLevel: 5, dragFuel: 0.5 },
  { id: 'lowbed-4', body: 'lowbed', brand: 'Iskar Steel', name: 'Нискорамно ремарке 4 оси', priceCents: 86_000_00, payloadTons: 40, axles: 4, requiresHeavyHaul: true, minLevel: 7, dragFuel: 3 },
];

export type UpgradeId = 'eco_tune' | 'aero_kit' | 'premium_tyres' | 'comfort_cab';

export interface UpgradeDefinition {
  id: UpgradeId;
  label: string;
  description: string;
  priceCents: number;
  /** Multiplicative fuel factor, wear factor, XP factor. */
  fuel: number;
  wear: number;
  xp: number;
  appliesTo: PowerUnitKind[];
}

export const UPGRADES: Record<UpgradeId, UpgradeDefinition> = {
  eco_tune: { id: 'eco_tune', label: 'Еко настройка на двигателя', description: '−8 % разход на гориво', priceCents: 3_800_00, fuel: 0.92, wear: 1, xp: 1, appliesTo: ['van', 'rigid', 'tractor'] },
  aero_kit: { id: 'aero_kit', label: 'Аеродинамичен пакет', description: '−5 % разход на гориво', priceCents: 4_500_00, fuel: 0.95, wear: 1, xp: 1, appliesTo: ['rigid', 'tractor'] },
  premium_tyres: { id: 'premium_tyres', label: 'Премиум гуми', description: '−25 % износване', priceCents: 2_900_00, fuel: 1, wear: 0.75, xp: 1, appliesTo: ['van', 'rigid', 'tractor'] },
  comfort_cab: { id: 'comfort_cab', label: 'Комфортна кабина', description: '+10 % опит от доставки', priceCents: 5_200_00, fuel: 1, wear: 1, xp: 1.1, appliesTo: ['rigid', 'tractor'] },
};

export function powerUnitModel(id: string): PowerUnitModel {
  const m = POWER_UNITS.find((p) => p.id === id);
  if (!m) throw new Error(`Unknown power unit model ${id}`);
  return m;
}

export function trailerModel(id: string): TrailerModel {
  const m = TRAILERS.find((t) => t.id === id);
  if (!m) throw new Error(`Unknown trailer model ${id}`);
  return m;
}

export interface Combination {
  unit: PowerUnitModel;
  trailer: TrailerModel | null;
}

/** Body types and payload a power unit (with optional trailer) offers. */
export function combinationCapability({ unit, trailer }: Combination): { bodies: BodyType[]; payloadTons: number } {
  if (unit.kind === 'tractor') {
    if (!trailer) return { bodies: [], payloadTons: 0 };
    return { bodies: [trailer.body], payloadTons: trailer.payloadTons };
  }
  return { bodies: unit.body ? [unit.body] : [], payloadTons: unit.payloadTons };
}

export function canCouple(unit: PowerUnitModel, trailer: TrailerModel): boolean {
  return unit.kind === 'tractor' && (!trailer.requiresHeavyHaul || unit.heavyHaul);
}

/** Vehicles available for rent (no purchase price, a fee per delivery instead). */
export interface RentalOffer {
  id: string;
  unitId: string;
  trailerId: string | null;
  minLevel: number;
  /** Only companies can rent; the starter rental of an independent driver is automatic. */
  label: string;
}

export const RENTAL_OFFERS: RentalOffer[] = [
  { id: 'rent-van', unitId: 'sokol-courier', trailerId: null, minLevel: 1, label: 'Ван под наем' },
  { id: 'rent-rigid', unitId: 'hemus-r12-box', trailerId: null, minLevel: 1, label: 'Соло камион под наем' },
  { id: 'rent-frigo', unitId: 'hemus-r12-frigo', trailerId: null, minLevel: 2, label: 'Хладилен камион под наем' },
  { id: 'rent-curtain', unitId: 'danubia-t440', trailerId: 'curtain-13', minLevel: 2, label: 'Влекач + завеса под наем' },
];

/** The truck every new player starts with. */
export const STARTER_RENTAL = 'rent-rigid';

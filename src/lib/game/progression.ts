/** Levels, experience, reputation and achievements. Pure rules. */

export function xpForLevel(level: number): number {
  return level <= 1 ? 0 : Math.round(800 * (level - 1) ** 1.7);
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (level < 100 && xp >= xpForLevel(level + 1)) level++;
  return level;
}

export function levelProgress(xp: number): { level: number; current: number; next: number; share: number } {
  const level = levelForXp(xp);
  const current = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, current, next, share: (xp - current) / (next - current) };
}

export function deliveryXp(loadedKm: number, tons: number, onTime: boolean, xpFactor: number): number {
  const base = loadedKm * (1 + Math.min(tons, 40) / 24);
  return Math.round(base * (onTime ? 1 : 0.5) * xpFactor);
}

export function seasonPoints(loadedKm: number, tons: number, onTime: boolean): number {
  return Math.round(((loadedKm * Math.sqrt(Math.max(tons, 0.5))) / 10) * (onTime ? 1 : 0.4));
}

/**
 * Reputation (0–100) grows with on-time deliveries and drops with late ones. It
 * pays: a bonus on every reward and access to premium contracts.
 */
export const REPUTATION_TIERS = [
  { min: 0, label: 'Нов превозвач' },
  { min: 20, label: 'Надежден' },
  { min: 50, label: 'Доверен' },
  { min: 80, label: 'Елитен' },
] as const;

export function reputationTier(reputation: number) {
  return [...REPUTATION_TIERS].reverse().find((t) => reputation >= t.min)!;
}

/** Bonus on the freight reward: +1 % per 10 reputation, up to +10 %. */
export const reputationBonusShare = (reputation: number) => Math.min(0.1, Math.max(0, reputation) / 1000);

/** Premium contracts: who may take them and how much more they pay. */
export const PREMIUM_LEVELS = [
  { minReputation: 20, multiplier: 1.15 },
  { minReputation: 50, multiplier: 1.25 },
  { minReputation: 80, multiplier: 1.4 },
] as const;

export function reputationAfter(reputation: number, onTime: boolean): number {
  const next = onTime ? reputation + Math.max(0.25, (100 - reputation) / 40) : reputation - 3;
  return Math.round(Math.min(100, Math.max(0, next)) * 100) / 100;
}

export interface CompanyStats {
  deliveries: number;
  onTimeDeliveries: number;
  totalKm: number;
  vehicles: number;
  drivers: number;
  depots: number;
  countriesServed: number;
  level: number;
  balanceCents: number;
  maxSingleRewardCents: number;
}

export interface AchievementDefinition {
  key: string;
  title: string;
  description: string;
  tier: 'bronze' | 'silver' | 'gold' | 'prestige';
  rewardCents: number;
  rewardXp: number;
  check: (s: CompanyStats) => boolean;
  /** Progress 0..1 for goals UI. */
  progress: (s: CompanyStats) => number;
}

const ratio = (v: number, target: number) => Math.min(1, v / target);

export const ACHIEVEMENTS: AchievementDefinition[] = [
  { key: 'first_delivery', title: 'Първи курс', description: 'Завърши първата си доставка.', tier: 'bronze', rewardCents: 1_000_00, rewardXp: 100,
    check: (s) => s.deliveries >= 1, progress: (s) => ratio(s.deliveries, 1) },
  { key: 'ten_deliveries', title: 'Надежден превозвач', description: 'Завърши 10 доставки.', tier: 'bronze', rewardCents: 3_000_00, rewardXp: 300,
    check: (s) => s.deliveries >= 10, progress: (s) => ratio(s.deliveries, 10) },
  { key: 'second_vehicle', title: 'Автопарк', description: 'Притежавай 2 превозни средства.', tier: 'bronze', rewardCents: 2_000_00, rewardXp: 150,
    check: (s) => s.vehicles >= 2, progress: (s) => ratio(s.vehicles, 2) },
  { key: 'international', title: 'Без граници', description: 'Доставяй до 3 различни държави.', tier: 'silver', rewardCents: 5_000_00, rewardXp: 500,
    check: (s) => s.countriesServed >= 3, progress: (s) => ratio(s.countriesServed, 3) },
  { key: 'km_10000', title: '10 000 километра', description: 'Измини общо 10 000 км.', tier: 'silver', rewardCents: 6_000_00, rewardXp: 600,
    check: (s) => s.totalKm >= 10_000, progress: (s) => ratio(s.totalKm, 10_000) },
  { key: 'punctual_25', title: 'Швейцарски часовник', description: '25 доставки навреме.', tier: 'silver', rewardCents: 8_000_00, rewardXp: 800,
    check: (s) => s.onTimeDeliveries >= 25, progress: (s) => ratio(s.onTimeDeliveries, 25) },
  { key: 'second_depot', title: 'Регионален играч', description: 'Открий второ депо.', tier: 'silver', rewardCents: 5_000_00, rewardXp: 400,
    check: (s) => s.depots >= 2, progress: (s) => ratio(s.depots, 2) },
  { key: 'fleet_10', title: 'Логистична компания', description: 'Притежавай 10 превозни средства.', tier: 'gold', rewardCents: 25_000_00, rewardXp: 2_000,
    check: (s) => s.vehicles >= 10, progress: (s) => ratio(s.vehicles, 10) },
  { key: 'millionaire', title: 'Милионер', description: 'Достигни баланс от 1 000 000 €.', tier: 'prestige', rewardCents: 0, rewardXp: 5_000,
    check: (s) => s.balanceCents >= 1_000_000_00, progress: (s) => ratio(s.balanceCents, 1_000_000_00) },
  { key: 'level_10', title: 'Ветеран на пътя', description: 'Достигни ниво 10.', tier: 'prestige', rewardCents: 50_000_00, rewardXp: 0,
    check: (s) => s.level >= 10, progress: (s) => ratio(s.level, 10) },
];

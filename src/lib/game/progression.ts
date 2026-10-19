/** Levels, experience, reputation and achievements. Pure rules. */

/**
 * Level curve (v1.1): steeper than before, so levels mean weeks of play, not a
 * day — level 10 ≈ 125 000 XP, level 20 ≈ 650 000, level 30 ≈ 1 660 000.
 */
export const XP_CURVE = { base: 1000, power: 2.2 } as const;

export function xpForLevel(level: number): number {
  return level <= 1 ? 0 : Math.round(XP_CURVE.base * (level - 1) ** XP_CURVE.power);
}

/** The curve before v1.1 (used once to carry players over to the new one). */
export function legacyXpForLevel(level: number): number {
  return level <= 1 ? 0 : Math.round(800 * (level - 1) ** 1.7);
}

/** Share of a hired driver's delivery XP that also goes to the player (their own driving gives it all). v1.3: 0.25 → 0.1 — a big fleet levelled players far too fast. */
export const FLEET_XP_SHARE = 0.1;

/** Share of a member's delivery XP that goes to the company (hired drivers' trips: times FLEET_XP_SHARE). */
export const COMPANY_XP_SHARE = 0.5;

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

/** XP of one delivery: a little for every trip, more for distance and weight (≈ 300 for 500 km with 20 t). */
export function deliveryXp(loadedKm: number, tons: number, onTime: boolean, xpFactor: number): number {
  const base = 40 + loadedKm * 0.35 * (1 + Math.min(tons, 40) / 40);
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
  /** v1.1 systems. */
  teamTrips: number;
  cleanTrips: number;
  carTrips: number;
  steelTrips: number;
  tandemTons: number;
  nightTrips: number;
  clientContracts: number;
  appealsWon: number;
  insuredVehicles: number;
  ghosts: number;
  newsStar: boolean;
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
  /** A badge for the profile that comes with it. */
  badge?: string;
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
  { key: 'millionaire', title: 'Милионер', description: 'Достигни баланс от 1 000 000 лв.', tier: 'prestige', rewardCents: 0, rewardXp: 5_000,
    check: (s) => s.balanceCents >= 1_000_000_00, progress: (s) => ratio(s.balanceCents, 1_000_000_00) },
  { key: 'level_10', title: 'Ветеран на пътя', description: 'Достигни ниво 10.', tier: 'prestige', rewardCents: 50_000_00, rewardXp: 0,
    check: (s) => s.level >= 10, progress: (s) => ratio(s.level, 10) },

  // ── v1.1 ──
  { key: 'team_10', title: 'Двоен екипаж', description: '10 курса с двоен екипаж.', tier: 'silver', rewardCents: 4_000_00, rewardXp: 600,
    check: (s) => s.teamTrips >= 10, progress: (s) => ratio(s.teamTrips, 10) },
  { key: 'team_100', title: 'Неуморимите', description: '100 курса с двоен екипаж.', tier: 'gold', rewardCents: 20_000_00, rewardXp: 3_000,
    check: (s) => s.teamTrips >= 100, progress: (s) => ratio(s.teamTrips, 100) },
  { key: 'tandem_100t', title: 'Тежка категория', description: 'Превози 100 т със соло камион и прикачно ремарке.', tier: 'silver', rewardCents: 5_000_00, rewardXp: 700,
    check: (s) => s.tandemTons >= 100, progress: (s) => ratio(s.tandemTons, 100) },
  { key: 'cars_10', title: 'Автовоз', description: '10 доставки на нови автомобили.', tier: 'silver', rewardCents: 6_000_00, rewardXp: 800,
    check: (s) => s.carTrips >= 10, progress: (s) => ratio(s.carTrips, 10) },
  { key: 'steel_10', title: 'Стоманеният път', description: '10 доставки на метали и дървен материал.', tier: 'silver', rewardCents: 5_000_00, rewardXp: 700,
    check: (s) => s.steelTrips >= 10, progress: (s) => ratio(s.steelTrips, 10) },
  { key: 'client_1', title: 'Първи клиент', description: 'Изпълни договор с клиент.', tier: 'bronze', rewardCents: 2_000_00, rewardXp: 300,
    check: (s) => s.clientContracts >= 1, progress: (s) => ratio(s.clientContracts, 1) },
  { key: 'client_5', title: 'Верен партньор', description: 'Изпълни 5 договора с клиенти.', tier: 'gold', rewardCents: 15_000_00, rewardXp: 2_000, badge: 'partner',
    check: (s) => s.clientContracts >= 5, progress: (s) => ratio(s.clientContracts, 5) },
  { key: 'clean_30', title: 'Чиста книжка', description: '30 доставки навреме без никакъв риск (без претоварване и без пропусната почивка).', tier: 'silver', rewardCents: 6_000_00, rewardXp: 900,
    check: (s) => s.cleanTrips >= 30, progress: (s) => ratio(s.cleanTrips, 30) },
  { key: 'night_20', title: 'Нощна смяна', description: '20 доставки, пристигнали нощем (22:00–06:00).', tier: 'silver', rewardCents: 5_000_00, rewardXp: 800,
    check: (s) => s.nightTrips >= 20, progress: (s) => ratio(s.nightTrips, 20) },
  { key: 'appeal_won', title: 'Адвокат', description: 'Спечели обжалване на глоба.', tier: 'bronze', rewardCents: 1_000_00, rewardXp: 200,
    check: (s) => s.appealsWon >= 1, progress: (s) => ratio(s.appealsWon, 1) },
  { key: 'insured_3', title: 'Спокоен сън', description: '3 застраховани камиона едновременно.', tier: 'bronze', rewardCents: 2_000_00, rewardXp: 300,
    check: (s) => s.insuredVehicles >= 3, progress: (s) => ratio(s.insuredVehicles, 3) },
  { key: 'ghost_3', title: 'Ловец на призраци', description: 'Срещни призрачния камион 3 пъти.', tier: 'silver', rewardCents: 3_000_00, rewardXp: 500, badge: 'ghost-hunter',
    check: (s) => s.ghosts >= 3, progress: (s) => ratio(s.ghosts, 3) },
  { key: 'news_star', title: 'Звезда на седмичника', description: 'Попадни в класациите на Седмичника.', tier: 'gold', rewardCents: 10_000_00, rewardXp: 1_500, badge: 'news-star',
    check: (s) => s.newsStar, progress: (s) => (s.newsStar ? 1 : 0) },
  { key: 'deliveries_500', title: 'Пътен ветеран', description: 'Завърши 500 доставки.', tier: 'gold', rewardCents: 30_000_00, rewardXp: 4_000,
    check: (s) => s.deliveries >= 500, progress: (s) => ratio(s.deliveries, 500) },
  { key: 'km_100000', title: '100 000 километра', description: 'Измини общо 100 000 км.', tier: 'gold', rewardCents: 25_000_00, rewardXp: 3_500,
    check: (s) => s.totalKm >= 100_000, progress: (s) => ratio(s.totalKm, 100_000) },
  { key: 'level_20', title: 'Легенда на пътя', description: 'Достигни ниво 20.', tier: 'prestige', rewardCents: 100_000_00, rewardXp: 0, badge: 'legend',
    check: (s) => s.level >= 20, progress: (s) => ratio(s.level, 20) },
];

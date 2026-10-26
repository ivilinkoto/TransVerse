import { t as tr, intlLocale } from '@/i18n/t';
/**
 * Daily, weekly, monthly and season missions. Pure rules shared by server and UI.
 *
 * Every player gets a few missions per period, picked deterministically from the
 * pool among the ones they can actually do (level and licences). Targets and
 * rewards grow with the player's level tier and are frozen when assigned.
 */

export const MISSION_PERIODS = ['daily', 'weekly', 'monthly', 'season'] as const;
export type MissionPeriod = (typeof MISSION_PERIODS)[number];

export const PERIOD_LABELS: Record<MissionPeriod, string> = { daily: 'Дневни', weekly: 'Седмични', monthly: 'Месечни', season: 'Сезонни' };
/** How many missions a player gets per period. */
export const MISSIONS_PER_PERIOD: Record<MissionPeriod, number> = { daily: 3, weekly: 3, monthly: 3, season: 4 };

/** What a finished delivery contributes to missions. */
export interface DeliveryFacts {
  loadedKm: number;
  tons: number;
  onTime: boolean;
  rewardCents: number;
  cargoType: string;
  /** Countries of the loaded route, both ends included. */
  countries: string[];
  urgent: boolean;
  /** Delivered while a member of a company. */
  inCompany: boolean;
  /** A holiday load (Halloween…). */
  holiday?: boolean;
}

export type Metric =
  | 'deliveries'
  | 'on_time'
  | 'km'
  | 'tons'
  | 'earned_cents'
  | 'international'
  | 'countries'
  | 'long_haul'
  | 'refrigerated'
  | 'heavy'
  | 'company_deliveries';

export const LONG_HAUL_KM = 800;

/** Increment a delivery gives to a metric (the distinct-countries metric is handled with its own state). */
export function metricIncrement(metric: Metric, f: DeliveryFacts): number {
  switch (metric) {
    case 'deliveries':
      return 1;
    case 'on_time':
      return f.onTime ? 1 : 0;
    case 'km':
      return Math.round(f.loadedKm);
    case 'tons':
      return Math.round(f.tons * 10) / 10;
    case 'earned_cents':
      return f.rewardCents;
    case 'international':
      return new Set(f.countries).size > 1 ? 1 : 0;
    case 'long_haul':
      return f.loadedKm >= LONG_HAUL_KM ? 1 : 0;
    case 'refrigerated':
      return f.cargoType === 'refrigerated' ? 1 : 0;
    case 'heavy':
      return f.tons >= 15 ? 1 : 0;
    case 'company_deliveries':
      return f.inCompany ? 1 : 0;
    case 'countries':
      return 0;
  }
}

export interface PlayerProfile {
  level: number;
  licences: ReadonlySet<string>;
  inCompany: boolean;
}

export interface MissionDefinition {
  id: string;
  period: MissionPeriod;
  metric: Metric;
  /** Target for level tier 0 (levels 1–4); multiplied for higher tiers. */
  base: number;
  rewardCents: number;
  rewardXp: number;
  title: (target: number) => string;
  /** Who can be given this mission. */
  eligible?: (p: PlayerProfile) => boolean;
  /** Fixed target (not scaled by tier), e.g. "deliver to all 9 countries". */
  fixed?: boolean;
}

const eur = (cents: number) => tr('{0} лв.', Math.round(cents / 100).toLocaleString(intlLocale()));
const num = (n: number) => n.toLocaleString(intlLocale());
const international = (p: PlayerProfile) => p.licences.has('international');

export const MISSIONS: MissionDefinition[] = [
  // ── Daily ──
  { id: 'd_deliveries', period: 'daily', metric: 'deliveries', base: 3, rewardCents: 400_00, rewardXp: 80, title: (t) => tr('Изпълни {0} доставки', t) },
  { id: 'd_on_time', period: 'daily', metric: 'on_time', base: 2, rewardCents: 450_00, rewardXp: 90, title: (t) => tr('Достави {0} товара навреме', t) },
  { id: 'd_km', period: 'daily', metric: 'km', base: 600, rewardCents: 500_00, rewardXp: 100, title: (t) => tr('Измини {0} км с товар', num(t)) },
  { id: 'd_earned', period: 'daily', metric: 'earned_cents', base: 1_500_00, rewardCents: 450_00, rewardXp: 90, title: (t) => tr('Спечели {0} от възнаграждения', eur(t)) },
  { id: 'd_tons', period: 'daily', metric: 'tons', base: 8, rewardCents: 400_00, rewardXp: 80, title: (t) => tr('Превози общо {0} тона', num(t)) },
  { id: 'd_international', period: 'daily', metric: 'international', base: 1, rewardCents: 600_00, rewardXp: 120, title: (t) => (t === 1 ? tr('Изпълни 1 международна доставка') : tr('Изпълни {0} международни доставки', t)), eligible: international },
  { id: 'd_company', period: 'daily', metric: 'company_deliveries', base: 2, rewardCents: 450_00, rewardXp: 100, title: (t) => tr('Изпълни {0} доставки за компанията си', t), eligible: (p) => p.inCompany },

  // ── Weekly ──
  { id: 'w_deliveries', period: 'weekly', metric: 'deliveries', base: 15, rewardCents: 2_500_00, rewardXp: 500, title: (t) => tr('Изпълни {0} доставки', t) },
  { id: 'w_on_time', period: 'weekly', metric: 'on_time', base: 12, rewardCents: 2_800_00, rewardXp: 550, title: (t) => tr('Достави {0} товара навреме', t) },
  { id: 'w_km', period: 'weekly', metric: 'km', base: 4_000, rewardCents: 3_000_00, rewardXp: 600, title: (t) => tr('Измини {0} км с товар', num(t)) },
  { id: 'w_earned', period: 'weekly', metric: 'earned_cents', base: 10_000_00, rewardCents: 2_800_00, rewardXp: 550, title: (t) => tr('Спечели {0} от възнаграждения', eur(t)) },
  { id: 'w_international', period: 'weekly', metric: 'international', base: 5, rewardCents: 3_500_00, rewardXp: 700, title: (t) => tr('Изпълни {0} международни доставки', t), eligible: international },
  { id: 'w_countries', period: 'weekly', metric: 'countries', base: 3, rewardCents: 3_500_00, rewardXp: 700, title: (t) => tr('Достави товар в {0} различни държави', t), eligible: international },
  { id: 'w_refrigerated', period: 'weekly', metric: 'refrigerated', base: 5, rewardCents: 3_200_00, rewardXp: 650, title: (t) => tr('Достави {0} хладилни товара', t), eligible: (p) => p.licences.has('reefer') },
  { id: 'w_company', period: 'weekly', metric: 'company_deliveries', base: 12, rewardCents: 3_000_00, rewardXp: 650, title: (t) => tr('Изпълни {0} доставки за компанията си', t), eligible: (p) => p.inCompany },

  // ── Monthly ──
  { id: 'm_deliveries', period: 'monthly', metric: 'deliveries', base: 60, rewardCents: 10_000_00, rewardXp: 2_000, title: (t) => tr('Изпълни {0} доставки', t) },
  { id: 'm_km', period: 'monthly', metric: 'km', base: 18_000, rewardCents: 12_000_00, rewardXp: 2_400, title: (t) => tr('Измини {0} км с товар', num(t)) },
  { id: 'm_earned', period: 'monthly', metric: 'earned_cents', base: 45_000_00, rewardCents: 11_000_00, rewardXp: 2_200, title: (t) => tr('Спечели {0} от възнаграждения', eur(t)) },
  { id: 'm_tons', period: 'monthly', metric: 'tons', base: 250, rewardCents: 10_000_00, rewardXp: 2_000, title: (t) => tr('Превози общо {0} тона', num(t)) },
  { id: 'm_long_haul', period: 'monthly', metric: 'long_haul', base: 8, rewardCents: 13_000_00, rewardXp: 2_600, title: (t) => tr('Изпълни {0} курса над {1} км', t, LONG_HAUL_KM), eligible: international },
  { id: 'm_heavy', period: 'monthly', metric: 'heavy', base: 15, rewardCents: 12_000_00, rewardXp: 2_400, title: (t) => tr('Превози {0} товара над 15 тона', t), eligible: (p) => p.level >= 3 },

  // ── Season ──
  { id: 's_deliveries', period: 'season', metric: 'deliveries', base: 150, rewardCents: 30_000_00, rewardXp: 6_000, title: (t) => tr('Изпълни {0} доставки този сезон', t) },
  { id: 's_km', period: 'season', metric: 'km', base: 50_000, rewardCents: 35_000_00, rewardXp: 7_000, title: (t) => tr('Измини {0} км с товар този сезон', num(t)) },
  { id: 's_on_time', period: 'season', metric: 'on_time', base: 120, rewardCents: 32_000_00, rewardXp: 6_500, title: (t) => tr('Достави {0} товара навреме този сезон', t) },
  { id: 's_earned', period: 'season', metric: 'earned_cents', base: 120_000_00, rewardCents: 30_000_00, rewardXp: 6_000, title: (t) => tr('Спечели {0} от възнаграждения този сезон', eur(t)) },
  { id: 's_countries', period: 'season', metric: 'countries', base: 9, fixed: true, rewardCents: 45_000_00, rewardXp: 9_000, title: () => tr('Достави товар във всички 9 държави на картата'), eligible: international },
];

export const missionById = (id: string) => MISSIONS.find((m) => m.id === id);

/** Level tier: 0 for levels 1–4, then +1 every 5 levels (max 4). */
export function levelTier(level: number): number {
  return Math.min(4, Math.floor(Math.max(0, level - 1) / 5));
}

export function scaledTarget(m: MissionDefinition, level: number): number {
  if (m.fixed) return m.base;
  const t = m.base * (1 + 0.5 * levelTier(level));
  return m.metric === 'earned_cents' ? Math.round(t / 100_00) * 100_00 : m.metric === 'km' ? Math.round(t / 100) * 100 : Math.round(t);
}

export function scaledReward(m: MissionDefinition, level: number): { cents: number; xp: number } {
  const f = 1 + 0.4 * levelTier(level);
  return { cents: Math.round((m.rewardCents * f) / 100_00) * 100_00 || m.rewardCents, xp: Math.round(m.rewardXp * f) };
}

/** Deterministic pick: different players get different sets, the same player keeps theirs for the period. */
export function pickMissions(period: MissionPeriod, profile: PlayerProfile, seed: string, count = MISSIONS_PER_PERIOD[period], exclude: ReadonlySet<string> = new Set()): MissionDefinition[] {
  const pool = MISSIONS.filter((m) => m.period === period && !exclude.has(m.id) && (!m.eligible || m.eligible(profile)));
  const scored = pool.map((m) => ({ m, h: hash(`${seed}:${m.id}`) })).sort((a, b) => a.h - b.h);
  return scored.slice(0, count).map((x) => x.m);
}

/** ТрансКоин price of swapping a mission (VIPs get one free swap a day). */
export const MISSION_REROLL_COINS = 20;

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ── Periods (Bulgarian time) ─────────────────────────────────────────────

const TZ = 'Europe/Sofia';

export function sofiaParts(now: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** Offset of Sofia from UTC at an instant, in minutes. */
function sofiaOffsetMin(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/** UTC instant of local midnight (Sofia) on a calendar date. */
export function sofiaMidnight(y: number, m: number, d: number): Date {
  const guess = new Date(Date.UTC(y, m - 1, d));
  return new Date(guess.getTime() - sofiaOffsetMin(guess) * 60_000);
}

export interface PeriodWindow {
  key: string;
  endsAt: Date;
}

/** Period key and end time for daily/weekly/monthly missions. Season windows come from the seasons table. */
export function periodWindow(period: Exclude<MissionPeriod, 'season'>, now: Date): PeriodWindow {
  const { y, m, d } = sofiaParts(now);
  if (period === 'daily') {
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    return { key: `D${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, endsAt: sofiaMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()) };
  }
  if (period === 'monthly') {
    const next = new Date(Date.UTC(y, m, 1));
    return { key: `M${y}-${String(m).padStart(2, '0')}`, endsAt: sofiaMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, 1) };
  }
  // ISO week, Monday first.
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = (date.getUTCDay() + 6) % 7; // 0 = Monday
  const monday = new Date(date.getTime() - dow * 86_400_000);
  const thursday = new Date(monday.getTime() + 3 * 86_400_000);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  const nextMonday = new Date(monday.getTime() + 7 * 86_400_000);
  return { key: `W${thursday.getUTCFullYear()}-${String(week).padStart(2, '0')}`, endsAt: sofiaMidnight(nextMonday.getUTCFullYear(), nextMonday.getUTCMonth() + 1, nextMonday.getUTCDate()) };
}

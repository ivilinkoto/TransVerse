/**
 * Weekly company missions: goals the members reach together. Pure rules shared
 * by server and UI. Rewards go to the company treasury and company XP, paid
 * automatically when a mission is completed.
 */
import { hash, LONG_HAUL_KM, type DeliveryFacts } from './missions';
import { niceNumber } from './events';
import { t as tr, intlLocale } from '@/i18n/t';

export type CompanyMetric = 'deliveries' | 'tons' | 'km' | 'on_time' | 'international' | 'earned_cents' | 'active_members' | 'long_haul';

export interface CompanyMissionDefinition {
  id: string;
  metric: CompanyMetric;
  /** Target per member (scaled by the number of members). */
  perMember: number;
  /** Reward to the treasury and company XP for a one-member company (scaled the same way). */
  rewardCents: number;
  rewardXp: number;
  title: (target: number) => string;
  /** Needs at least this many members. */
  minMembers?: number;
}

const num = (n: number) => n.toLocaleString(intlLocale());
const eur = (cents: number) => tr('{0} лв.', Math.round(cents / 100).toLocaleString(intlLocale()));

export const COMPANY_MISSIONS: CompanyMissionDefinition[] = [
  { id: 'c_deliveries', metric: 'deliveries', perMember: 10, rewardCents: 4_000_00, rewardXp: 400, title: (t) => tr('Членовете да изпълнят {0} доставки', num(t)) },
  { id: 'c_tons', metric: 'tons', perMember: 120, rewardCents: 4_500_00, rewardXp: 450, title: (t) => tr('Превозете заедно {0} тона', num(t)) },
  { id: 'c_km', metric: 'km', perMember: 3_500, rewardCents: 4_500_00, rewardXp: 450, title: (t) => tr('Изминете заедно {0} км с товар', num(t)) },
  { id: 'c_on_time', metric: 'on_time', perMember: 8, rewardCents: 4_500_00, rewardXp: 450, title: (t) => tr('{0} доставки навреме', num(t)) },
  { id: 'c_international', metric: 'international', perMember: 3, rewardCents: 5_000_00, rewardXp: 500, title: (t) => tr('{0} международни доставки', num(t)) },
  { id: 'c_earned', metric: 'earned_cents', perMember: 12_000_00, rewardCents: 4_500_00, rewardXp: 450, title: (t) => tr('Спечелете заедно {0} навло', eur(t)) },
  { id: 'c_long_haul', metric: 'long_haul', perMember: 2, rewardCents: 5_000_00, rewardXp: 500, title: (t) => tr('{0} курса над {1} км', num(t), LONG_HAUL_KM) },
  { id: 'c_active', metric: 'active_members', perMember: 0.6, rewardCents: 3_500_00, rewardXp: 600, title: (t) => tr('{0} различни членове да направят доставка', num(t)), minMembers: 3 },
];

export const COMPANY_MISSIONS_PER_WEEK = 3;

export const companyMissionById = (id: string) => COMPANY_MISSIONS.find((m) => m.id === id);

/** Growth with the team: more members, bigger goals and rewards (but not linearly). */
export function teamFactor(members: number): number {
  return Math.pow(Math.max(1, Math.min(100, members)), 0.85);
}

export function companyMissionTarget(m: CompanyMissionDefinition, members: number): number {
  if (m.metric === 'active_members') return Math.max(2, Math.ceil(members * m.perMember));
  return Math.max(1, niceNumber(m.perMember * teamFactor(members)));
}

/** Reward grows with the team and a little with the company level. */
export function companyMissionReward(m: CompanyMissionDefinition, members: number, companyLevel: number): { cents: number; xp: number } {
  const f = teamFactor(members) * (1 + 0.05 * Math.max(0, companyLevel - 1));
  return { cents: Math.round((m.rewardCents * f) / 100_00) * 100_00, xp: Math.round(m.rewardXp * f) };
}

/** Deterministic weekly pick per company and week. */
export function pickCompanyMissions(seed: string, members: number, count = COMPANY_MISSIONS_PER_WEEK): CompanyMissionDefinition[] {
  const pool = COMPANY_MISSIONS.filter((m) => members >= (m.minMembers ?? 1));
  const scored = pool.map((m) => ({ m, h: hash(`${seed}:${m.id}`) })).sort((a, b) => a.h - b.h);
  return scored.slice(0, count).map((s) => s.m);
}

/** What a member's delivery adds (active members are counted separately). */
export function companyIncrement(metric: CompanyMetric, f: DeliveryFacts): number {
  switch (metric) {
    case 'deliveries':
      return 1;
    case 'tons':
      return Math.round(f.tons * 10) / 10;
    case 'km':
      return Math.round(f.loadedKm);
    case 'on_time':
      return f.onTime ? 1 : 0;
    case 'international':
      return new Set(f.countries).size > 1 ? 1 : 0;
    case 'earned_cents':
      return f.rewardCents;
    case 'long_haul':
      return f.loadedKm >= LONG_HAUL_KM ? 1 : 0;
    case 'active_members':
      return 0;
  }
}

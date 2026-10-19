import type { CargoType } from './cargo';
import { teamFactor } from './company-missions';
import { niceNumber } from './events';
import { hash } from './missions';

/**
 * Company projects: a big goal the members haul together over a week —
 * e.g. steel for a new bridge in Ruse. Every member delivery of that cargo
 * to that city counts its tonnes. Done in time: money and XP for the
 * company and ТрансКоин for everyone who helped. Game data (fictional
 * projects in real cities).
 */
export interface ProjectTemplate {
  id: string;
  title: string;
  /** Destination: a real city (GeoNames name and country). */
  city: string;
  country: string;
  cargo: CargoType;
  /** What is hauled, for the text. */
  goods: string;
  /** Tonnes per member before the team scaling. */
  tonsPerMember: number;
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  { id: 'ruse_bridge', title: 'Нов мост при Русе', city: 'Ruse', country: 'BG', cargo: 'steel', goods: 'стомана', tonsPerMember: 70 },
  { id: 'varna_port', title: 'Разширение на пристанище Варна', city: 'Varna', country: 'BG', cargo: 'container', goods: 'контейнери', tonsPerMember: 80 },
  { id: 'sofia_metro', title: 'Нова линия на метрото в София', city: 'Sofia', country: 'BG', cargo: 'special', goods: 'тунелна техника', tonsPerMember: 60 },
  { id: 'plovdiv_park', title: 'Логистичен парк край Пловдив', city: 'Plovdiv', country: 'BG', cargo: 'pallets', goods: 'палетизирани стоки', tonsPerMember: 50 },
  { id: 'burgas_refinery', title: 'Зимен запас в Бургас', city: 'Burgas', country: 'BG', cargo: 'liquid', goods: 'горива', tonsPerMember: 70 },
  { id: 'bucharest_mall', title: 'Нов търговски център в Букурещ', city: 'Bucharest', country: 'RO', cargo: 'pallets', goods: 'стоки за откриването', tonsPerMember: 50 },
  { id: 'thessaloniki_market', title: 'Хладилна борса в Солун', city: 'Thessaloníki', country: 'GR', cargo: 'refrigerated', goods: 'храни', tonsPerMember: 45 },
  { id: 'belgrade_stadium', title: 'Стадион в Белград', city: 'Belgrade', country: 'RS', cargo: 'bulk', goods: 'насипни материали', tonsPerMember: 80 },
];

export const PROJECT_RULES = {
  days: 7,
  /** Offered templates per company and week (the members with the right pick one). */
  offers: 3,
  rewardCents: 8_000_00,
  rewardXp: 900,
  /** ТрансКоин for each member who hauled at least this share of the target. */
  helperCoins: 15,
  helperShare: 0.05,
} as const;

export const projectTemplate = (id: string) => PROJECT_TEMPLATES.find((t) => t.id === id);

export function projectTarget(t: ProjectTemplate, members: number): number {
  return Math.max(20, niceNumber(t.tonsPerMember * teamFactor(members)));
}

export function projectReward(members: number, companyLevel: number): { cents: number; xp: number } {
  const f = teamFactor(members) * (1 + 0.05 * Math.max(0, companyLevel - 1));
  return { cents: Math.round((PROJECT_RULES.rewardCents * f) / 100_00) * 100_00, xp: Math.round(PROJECT_RULES.rewardXp * f) };
}

/** The week's offer for a company (the same for all its members that week). */
export function projectOffers(seed: string): ProjectTemplate[] {
  return [...PROJECT_TEMPLATES].sort((a, b) => hash(`${seed}:${a.id}`) - hash(`${seed}:${b.id}`)).slice(0, PROJECT_RULES.offers);
}

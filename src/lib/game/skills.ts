/**
 * 1.3 „Умения на шофьора“: the player's own skill tree — three branches of three
 * skills, three ranks each. One point per player level above the first. The
 * effects are small and are paid on each delivery as one ledger line
 * („Умения на шофьора“), never by changing the trip's own costs. Game data.
 */
export type SkillId = 'fuel_saver' | 'gentle' | 'toll_wise' | 'haggler' | 'punctual' | 'long_haul' | 'boss' | 'convoy' | 'night_owl';
export type Branch = 'road' | 'trade' | 'people';

export interface SkillDef {
  branch: Branch;
  label: string;
  emoji: string;
  /** What one rank gives, as text with {0} for the number. */
  effect: string;
  /** One rank, as a share (0.02 = 2 %). */
  perRank: number;
}

export const BRANCHES: Record<Branch, { label: string; emoji: string; colour: string }> = {
  road: { label: 'Пътят', emoji: '🛣️', colour: '#22d3ee' },
  trade: { label: 'Търговия', emoji: '💼', colour: '#f6c343' },
  people: { label: 'Хора', emoji: '👥', colour: '#a78bfa' },
};

export const SKILLS: Record<SkillId, SkillDef> = {
  fuel_saver: { branch: 'road', label: 'Икономично каране', emoji: '⛽', effect: '−{0}% разход за гориво', perRank: 0.02 },
  gentle: { branch: 'road', label: 'Внимателно каране', emoji: '🔧', effect: '−{0}% разход за поддръжка', perRank: 0.03 },
  toll_wise: { branch: 'road', label: 'Познавач на пътя', emoji: '🧾', effect: '−{0}% пътни такси', perRank: 0.03 },
  haggler: { branch: 'trade', label: 'Пазарлък', emoji: '🤝', effect: '+{0}% към заплащането', perRank: 0.01 },
  punctual: { branch: 'trade', label: 'Точност', emoji: '⏱️', effect: '+{0}% към бонуса за ранна доставка', perRank: 0.1 },
  long_haul: { branch: 'trade', label: 'Далечни курсове', emoji: '🗺️', effect: '+{0}% на курсовете над 800 км', perRank: 0.02 },
  boss: { branch: 'people', label: 'Добър шеф', emoji: '🧑‍✈️', effect: '+{0}% на курсовете на наетите шофьори', perRank: 0.02 },
  convoy: { branch: 'people', label: 'Колега на пътя', emoji: '🚚', effect: '+{0}% на курсовете в конвой', perRank: 0.03 },
  night_owl: { branch: 'people', label: 'Нощна птица', emoji: '🦉', effect: '+{0}% при пристигане 22:00–06:00', perRank: 0.03 },
};
export const SKILL_IDS = Object.keys(SKILLS) as SkillId[];

export const SKILL_RULES = {
  maxRank: 3,
  /** The first reset is free, then it costs this much. */
  resetCents: 5_000_00,
} as const;

export type Ranks = Partial<Record<SkillId, number>>;

/** Points a player of this level has in all. */
export const skillPoints = (level: number) => Math.max(0, level - 1);
export const spentPoints = (ranks: Ranks) => SKILL_IDS.reduce((s, id) => s + (ranks[id] ?? 0), 0);

export interface TripForSkills {
  rewardCents: number;
  bonusCents: number;
  fuelCents: number;
  maintenanceCents: number;
  tollCents: number;
  loadedKm: number;
  ownerDrove: boolean;
  convoy: boolean;
  sofiaHour: number;
}

/** What the skills add to one delivery, in cents (never negative). */
export function skillsBonusCents(ranks: Ranks, f: TripForSkills): number {
  const r = (id: SkillId) => (ranks[id] ?? 0) * SKILLS[id].perRank;
  let cents = 0;
  cents += f.fuelCents * r('fuel_saver');
  cents += f.maintenanceCents * r('gentle');
  cents += f.tollCents * r('toll_wise');
  cents += f.rewardCents * r('haggler');
  cents += f.bonusCents * r('punctual');
  if (f.loadedKm >= 800) cents += f.rewardCents * r('long_haul');
  if (!f.ownerDrove) cents += f.rewardCents * r('boss');
  if (f.convoy) cents += f.rewardCents * r('convoy');
  if (f.sofiaHour >= 22 || f.sofiaHour < 6) cents += f.rewardCents * r('night_owl');
  return Math.max(0, Math.round(cents));
}

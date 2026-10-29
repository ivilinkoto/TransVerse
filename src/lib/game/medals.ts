/**
 * Season medals and company achievements (v1.1.3.1).
 *
 * - Medals come from the final place in a finished season: players 1–3 gold,
 *   4–10 silver, 11–25 bronze; player companies 1 gold, 2 silver, 3 bronze.
 *   Each medal kind is also a badge (`season-gold` …) for the profile showcase.
 * - Company achievements are earned by the company as a whole and shown as
 *   badges on its public profile.
 */
export const MEDALS = ['gold', 'silver', 'bronze'] as const;
export type Medal = (typeof MEDALS)[number];

export const MEDAL_INFO: Record<Medal, { icon: string; label: string; badge: string }> = {
  gold: { icon: '🥇', label: 'Златен медал', badge: 'season-gold' },
  silver: { icon: '🥈', label: 'Сребърен медал', badge: 'season-silver' },
  bronze: { icon: '🥉', label: 'Бронзов медал', badge: 'season-bronze' },
};

/** Last place that still wins a medal of each kind. */
export const PLAYER_MEDAL_PLACES = { gold: 3, silver: 10, bronze: 25 } as const;
export const COMPANY_MEDAL_PLACES = { gold: 1, silver: 2, bronze: 3 } as const;

const medalFor = (places: Record<Medal, number>, rank: number | null | undefined): Medal | null =>
  rank == null || rank < 1 ? null : (MEDALS.find((m) => rank <= places[m]) ?? null);

export const playerMedal = (rank: number | null | undefined) => medalFor(PLAYER_MEDAL_PLACES, rank);
export const companyMedal = (rank: number | null | undefined) => medalFor(COMPANY_MEDAL_PLACES, rank);

/** Counts of each medal in a list of medals. */
export function medalCounts(list: readonly (Medal | null)[]): Record<Medal, number> {
  const counts = { gold: 0, silver: 0, bronze: 0 };
  for (const m of list) if (m) counts[m]++;
  return counts;
}

export type CompanyAchievementTier = 'bronze' | 'silver' | 'gold' | 'prestige';

export interface CompanyStats {
  /** Deliveries of members while in the company (all seasons). */
  trips: number;
  members: number;
  treasuryCents: number;
  level: number;
  /** Finished seasons in the company top 10. */
  top10: number;
  /** Finished seasons won. */
  wins: number;
}

export interface CompanyAchievement {
  key: string;
  title: string;
  description: string;
  tier: CompanyAchievementTier;
  icon: string;
  check: (s: CompanyStats) => boolean;
}

export const COMPANY_ACHIEVEMENTS: CompanyAchievement[] = [
  { key: 'co_trips_100', title: 'Сработен екип', description: '100 курса на членовете заедно.', tier: 'bronze', icon: '🚚', check: (s) => s.trips >= 100 },
  { key: 'co_members_5', title: 'Петима на път', description: '5 членове в компанията.', tier: 'bronze', icon: '👥', check: (s) => s.members >= 5 },
  { key: 'co_trips_1000', title: 'Хиляда курса', description: '1 000 курса на членовете заедно.', tier: 'silver', icon: '🛣️', check: (s) => s.trips >= 1000 },
  { key: 'co_members_10', title: 'Голямо семейство', description: '10 членове в компанията.', tier: 'silver', icon: '🏠', check: (s) => s.members >= 10 },
  { key: 'co_treasury_1m', title: 'Пълна каса', description: '1 000 000 лв. в касата на компанията.', tier: 'silver', icon: '💰', check: (s) => s.treasuryCents >= 1_000_000_00 },
  { key: 'co_level_10', title: 'Утвърдена фирма', description: 'Компанията стига ниво 10.', tier: 'gold', icon: '🏢', check: (s) => s.level >= 10 },
  { key: 'co_top10_3', title: 'Постоянство', description: '3 сезона в топ 10 на компаниите.', tier: 'gold', icon: '📈', check: (s) => s.top10 >= 3 },
  { key: 'co_champion', title: 'Шампиони', description: 'Първо място в сезон на компаниите.', tier: 'prestige', icon: '🏆', check: (s) => s.wins >= 1 },
];

export const COMPANY_ACHIEVEMENT_TIER_ICON: Record<CompanyAchievementTier, string> = { bronze: '🥉', silver: '🥈', gold: '🥇', prestige: '💎' };

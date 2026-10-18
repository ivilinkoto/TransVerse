/**
 * Drivers: driving hours that carry over between trips, team crews and
 * skills. Pure game rules shared by server and UI.
 *
 * A driver may drive 9 h (real schedule time) before a daily rest. Hours left
 * over from the previous trip count on the next one, so a driver sent out
 * again straight away has to stop for the daily rest early — the trip takes
 * longer. Standing idle for CREW_RULES.restGameMin (game time) is a full rest.
 * A team of two drives up to 18 h without breaks before a shorter rest.
 */

export const CREW_RULES = {
  soloDailyMin: 540,
  teamDailyMin: 1080,
  teamRestMin: 540,
  /** Idle time (game minutes) after a trip that counts as the daily rest. */
  restGameMin: 20,
  /** Every point of "Издръжливост" adds this much daily driving. */
  longBonusMin: 30,
} as const;

export const TRAIT_IDS = ['eco', 'safe', 'long'] as const;
export type TraitId = (typeof TRAIT_IDS)[number];
export type Traits = Partial<Record<TraitId, number>>;

export const TRAIT_MAX = 3;

export const TRAITS: Record<TraitId, { label: string; short: string; perPoint: string }> = {
  eco: { label: 'Икономично каране', short: 'Икономичност', perPoint: '−3 % гориво' },
  safe: { label: 'Безопасно каране', short: 'Безопасност', perPoint: '−20 % шанс за пътно събитие, −8 % износване' },
  long: { label: 'Издръжливост', short: 'Издръжливост', perPoint: '+30 мин кормуване преди почивка' },
};

export const traitLevel = (traits: Traits | null | undefined, id: TraitId) => Math.max(0, Math.min(TRAIT_MAX, Math.floor(traits?.[id] ?? 0)));

/** One point per skill level above the first. */
export function traitPointsLeft(skill: number, traits: Traits | null | undefined): number {
  return Math.max(0, skill - 1 - TRAIT_IDS.reduce((s, id) => s + traitLevel(traits, id), 0));
}

export interface DriverState {
  dutyMin: number;
  restedAt: Date | null;
  traits?: Traits | null;
}

/** Driving minutes that still count at `now` (0 once the driver has rested). */
export function dutyAt(d: DriverState, now: Date): number {
  if (d.dutyMin <= 0 || !d.restedAt || d.restedAt <= now) return 0;
  return d.dutyMin;
}

/** Minutes until the driver is fully rested (0 if rested). */
export function restLeftMin(d: DriverState, now: Date): number {
  if (dutyAt(d, now) <= 0) return 0;
  return Math.max(1, Math.ceil((d.restedAt!.getTime() - now.getTime()) / 60_000));
}

export interface Crew {
  /** Driving minutes already used today (both drivers together for a team). */
  startDutyMin: number;
  team: boolean;
  /** Extra daily driving from the "long" skill. */
  extraDailyMin: number;
}

export interface CrewEffects extends Crew {
  /** Fuel factor and road-event / wear factors from skills. */
  fuel: number;
  eventChance: number;
  wear: number;
}

/** What a vehicle's crew (driver plus optional co-driver) brings to a trip. */
export function crewEffects(main: DriverState, co: DriverState | null, now: Date): CrewEffects {
  const best = (id: TraitId) => Math.max(traitLevel(main.traits, id), co ? traitLevel(co.traits, id) : 0);
  const long = co ? traitLevel(main.traits, 'long') + traitLevel(co.traits, 'long') : traitLevel(main.traits, 'long');
  return {
    startDutyMin: dutyAt(main, now) + (co ? dutyAt(co, now) : 0),
    team: !!co,
    extraDailyMin: long * CREW_RULES.longBonusMin,
    fuel: 1 - 0.03 * best('eco'),
    eventChance: Math.max(0, 1 - 0.2 * best('safe')),
    wear: 1 - 0.08 * best('safe'),
  };
}

export function dailyLimitMin(crew: Crew): number {
  return (crew.team ? CREW_RULES.teamDailyMin : CREW_RULES.soloDailyMin) + crew.extraDailyMin;
}

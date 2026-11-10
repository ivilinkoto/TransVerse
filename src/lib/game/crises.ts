import { sofiaDay } from './shop-v2';

/**
 * 1.3 „Световни кризи“: every two weeks a three-day crisis somewhere on the map.
 * Each day tells the next part of the story and sets a server goal in tonnes
 * delivered to the crisis country; meanwhile the players vote between two ways
 * out. Then for seven days the winning way pays a bonus on deliveries to its
 * country — the full bonus if the community reached at least two of the three
 * daily goals, half otherwise. Game data (the crises are invented).
 */
export interface CrisisOption { label: string; text: string; country: string }
export interface CrisisDef {
  title: string;
  emoji: string;
  country: string;
  days: [string, string, string];
  options: { a: CrisisOption; b: CrisisOption };
}

export const CRISES: Record<string, CrisisDef> = {
  port_strike: {
    title: 'Стачка в пристанище Констанца',
    emoji: '⚓',
    country: 'RO',
    days: [
      'Докерите в Констанца спряха работа. Контейнерите се трупат, а складовете в Румъния остават празни.',
      'Втори ден стачка. Магазините в Букурещ търсят стоки по суша — всеки камион е важен.',
      'Последен ден на преговорите. Каквото докараме днес, ще реши колко бързо се оправя пазарът.',
    ],
    options: {
      a: { label: 'Докарай по суша', text: 'Камионите поемат товарите на пристанището: +бонус за курсове до Румъния.', country: 'RO' },
      b: { label: 'Пренасочи към Варна', text: 'Корабите идват във Варна и стоките тръгват оттам: +бонус за курсове до България.', country: 'BG' },
    },
  },
  fuel_shortage: {
    title: 'Недостиг на дизел в Унгария',
    emoji: '⛽',
    country: 'HU',
    days: [
      'Рафинерия край Будапеща спря за ремонт. Бензиностанциите в Унгария ограничават продажбите.',
      'Опашки по магистралите. Доставките за Унгария стават все по-нужни.',
      'Рафинерията тръгва утре — днес е последният ден да помогнем.',
    ],
    options: {
      a: { label: 'Доставки за Унгария', text: 'Пълни камиони към унгарските градове: +бонус за курсове до Унгария.', country: 'HU' },
      b: { label: 'Обход през Сърбия', text: 'Превозвачите минават през Сърбия, докато кризата отмине: +бонус за курсове до Сърбия.', country: 'RS' },
    },
  },
  bridge_repair: {
    title: 'Ремонт на Дунав мост',
    emoji: '🌉',
    country: 'BG',
    days: [
      'Дунав мост при Русе затваря за спешен ремонт. Опашката от камиони е километрична.',
      'Фериботите при Видин и Свищов работят денонощно. Северна България чака стоки.',
      'Мостът отваря утре. Днес е последният ден да се снабдят градовете по Дунав.',
    ],
    options: {
      a: { label: 'Снабди Северна България', text: 'Стоки за градовете по Дунав: +бонус за курсове до България.', country: 'BG' },
      b: { label: 'През Видин към Румъния', text: 'Товарите за Румъния минават през Видин: +бонус за курсове до Румъния.', country: 'RO' },
    },
  },
  alpine_snow: {
    title: 'Снежна криза в Алпите',
    emoji: '🏔️',
    country: 'AT',
    days: [
      'Обилен сняг затвори проходите в Тирол. Селата в Австрия са откъснати от доставките.',
      'Снегорините работят, но храната и горивото в Австрия свършват.',
      'Пътищата се отварят един по един — последен ден на кризата.',
    ],
    options: {
      a: { label: 'Помощ за Австрия', text: 'Храна и гориво за австрийските градове: +бонус за курсове до Австрия.', country: 'AT' },
      b: { label: 'Обход през Германия', text: 'Товарите заобикалят Алпите през Германия: +бонус за курсове до Германия.', country: 'DE' },
    },
  },
};
export type CrisisId = keyof typeof CRISES;

export const CRISIS_RULES = {
  /** Server goal per crisis day, in tonnes delivered to the crisis country. */
  dailyTons: 150,
  /** Days of the crisis, then days of the winning way's bonus. */
  crisisDays: 3,
  effectDays: 7,
  /** The bonus on deliveries to the winning way's country: full with 2 of 3 daily goals, else half. */
  bonus: { full: 0.1, half: 0.05, goalsForFull: 2 },
} as const;

/** The schedule: a crisis every 14 days from the day after the release, the four in turn. */
export const CRISIS_START = '2026-11-13';
const ORDER: CrisisId[] = ['port_strike', 'fuel_shortage', 'bridge_repair', 'alpine_snow'];

const dayNumber = (day: string) => Math.floor(Date.parse(`${day}T12:00:00Z`) / 86_400_000);

export interface CrisisMoment {
  id: CrisisId;
  /** The crisis's serial number (0, 1, 2…), which makes its keys unique. */
  n: number;
  startDay: string;
  /** 0–2 during the crisis, 3–9 in the effect, null otherwise (set by phase). */
  dayIndex: number;
  phase: 'crisis' | 'effect';
}

/** The crisis (or its after-effect) running on this Sofia day, if any. */
export function crisisAt(now: Date): CrisisMoment | null {
  const d = dayNumber(sofiaDay(now)) - dayNumber(CRISIS_START);
  if (d < 0) return null;
  const n = Math.floor(d / 14);
  const i = d % 14;
  if (i >= CRISIS_RULES.crisisDays + CRISIS_RULES.effectDays) return null;
  const startDay = new Date((dayNumber(CRISIS_START) + n * 14) * 86_400_000).toISOString().slice(0, 10);
  return { id: ORDER[n % ORDER.length]!, n, startDay, dayIndex: i, phase: i < CRISIS_RULES.crisisDays ? 'crisis' : 'effect' };
}

/** The next crisis's start day (for the page between crises). */
export function nextCrisisDay(now: Date): { id: CrisisId; day: string } {
  const d = Math.max(0, dayNumber(sofiaDay(now)) - dayNumber(CRISIS_START));
  const n = d === 0 && dayNumber(sofiaDay(now)) < dayNumber(CRISIS_START) ? 0 : Math.floor(d / 14) + 1;
  return { id: ORDER[n % ORDER.length]!, day: new Date((dayNumber(CRISIS_START) + n * 14) * 86_400_000).toISOString().slice(0, 10) };
}

/** The effect's bonus share from the votes and the goals reached. */
export function crisisOutcome(votes: { a: number; b: number }, goalsMet: number): { option: 'a' | 'b'; share: number } {
  const option = votes.b > votes.a ? 'b' : 'a';
  return { option, share: goalsMet >= CRISIS_RULES.bonus.goalsForFull ? CRISIS_RULES.bonus.full : CRISIS_RULES.bonus.half };
}

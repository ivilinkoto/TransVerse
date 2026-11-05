import { inSeasonWindow, sofiaMonthDay } from './seasonal';

/**
 * 1.2.4 „Преди зимата“ (feature `winter_prep`): the last days of November.
 * Salt, sand, heating fuel and winter tyres go to the towns; the whole server
 * has one goal in tonnes, and when it is reached the first week of winter pays
 * a little more for everybody. Game data.
 */
export const PREWINTER = {
  year: 2026,
  from: '11-20',
  to: '11-30',
  contractShare: 0.22,
  rewardMultiplier: 1.2,
  goods: {
    bulk: ['Сол за пътищата', 'Пясък за опесъчаване', 'Луга за тротоари'],
    liquid: ['Дизел за отопление', 'Антифриз', 'Течност за чистачки — зимна'],
    pallets: ['Зимни гуми', 'Вериги за сняг', 'Пелети за отопление', 'Лопати и ралета за сняг'],
  } as Record<string, string[]>,
  /** The server goal in tonnes of winter goods, and the bonus for the first week of winter when it is reached. */
  goalTons: 5_000,
  winterWeek: { from: '12-01', to: '12-07', multiplier: 1.05 },
  /** Winter goods a player delivers on time for the badge (and the ТрансКоин). */
  loadsForBadge: 5,
  coins: 20,
  badge: 'winter-ready',
  /** Winter (and all-season) tyres cost less until the end of November. */
  tyreDiscount: 0.2,
} as const;

export const isPrewinter = (now: Date) => inSeasonWindow(sofiaMonthDay(now), PREWINTER);
export const isFirstWinterWeek = (now: Date) => inSeasonWindow(sofiaMonthDay(now), PREWINTER.winterWeek);
export const prewinterKey = (now: Date) => `prewinter:${new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia', year: 'numeric' }).format(now)}`;

/**
 * 1.2.4 „Черен петък“ (feature `black_friday`): four days at the end of
 * November — less ТрансКоин in the shop, a paint sold only then, and goods
 * for the big shopping cities that pay more.
 */
export const BLACK_FRIDAY = {
  from: '11-27',
  to: '11-30',
  /** Off every ТрансКоин item except VIP and the parts (the better of this and the weekly offer). */
  discount: 0.3,
  paintColor: '#111114',
  contractShare: 0.2,
  rewardMultiplier: 1.25,
  /** Only to cities this big. */
  minPopulation: 100_000,
  goods: {
    pallets: ['Телевизори и електроника', 'Пакети от онлайн магазини', 'Играчки', 'Дрехи и обувки'],
    refrigerated: ['Шоколади и бонбони', 'Храна за празничните оферти'],
  } as Record<string, string[]>,
} as const;

export const isBlackFriday = (now: Date) => inSeasonWindow(sofiaMonthDay(now), BLACK_FRIDAY);

import type { PassTask } from './first-snow';
import { sofiaHour } from './halloween';

/**
 * 1.4 „Коледна нощ“: the season after „Първи сняг“. A season that starts in December
 * takes this name and theme (or is renamed to it when 1.4 goes live, if it started a few
 * days before); its pass has its own rewards, two weekly tasks of its own and the ranking
 * „Дядо Коледа на пътищата“ (tonnes of Christmas loads in the season). Game data.
 */
export const CHRISTMAS_NIGHT = {
  name: 'Коледна нощ',
  /** The season's name as stored (and translated). */
  seasonName: 'Сезон „Коледна нощ“',
  theme: 'christmas_night',
  /** A season that starts (or is running) inside this window becomes „Коледна нощ“. */
  from: '2026-12-01T00:00:00+02:00',
  to: '2027-01-01T00:00:00+02:00',
  paintColor: '#14532d',
  livery: 'christmasnight',
  /** The season truck (premium level 50), in the season's colours. */
  truck: 'rila-xt620',
} as const;

export const inChristmasNightWindow = (at: Date) => at >= new Date(CHRISTMAS_NIGHT.from) && at < new Date(CHRISTMAS_NIGHT.to);

/** The season's own weekly tasks (they join the usual ones; the Christmas-loads one only in weeks that reach 15.12). */
export const CHRISTMAS_NIGHT_TASKS: PassTask[] = [
  { id: 'xmas-6', kind: 'xmas', target: 6, label: 'Достави 6 коледни товара' },
  { id: 'night-5', kind: 'night', target: 5, label: '5 доставки, пристигнали между 18:00 и 6:00' },
];

/** A delivery that arrives in the evening or at night (Sofia time). */
export const arrivesAtNight = (at: Date) => {
  const h = sofiaHour(at);
  return h >= 18 || h < 6;
};

/** „Дядо Коледа на пътищата“: tonnes of Christmas loads in the season; the top three get titles and ТрансКоин. */
export const SANTA_OF_ROADS = { places: [{ title: 'santa-of-roads', coins: 150 }, { title: 'santa-helper', coins: 80 }, { title: 'santa-helper', coins: 50 }] } as const;

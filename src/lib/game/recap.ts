/**
 * The year in TransVerse (годишна равносметка): from 15 December to the end
 * of January each player can open their recap of the calendar year (Sofia
 * time) — kilometres, records, the favourite lane, the convoy friend — and
 * save it as a picture to share. Game data.
 */
import { sofiaMidnight } from './missions';
import { inSeasonWindow, sofiaMonthDay } from './seasonal';

export const RECAP = { from: '12-15', to: '01-31' } as const;

/** Is the recap open now (players; staff can always look)? */
export const isRecapTime = (now: Date) => inSeasonWindow(sofiaMonthDay(now), RECAP);

/** The year the recap is about: the last one in January, otherwise this one (so far). */
export function recapYear(now: Date): number {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit' }).format(now).split('-').map(Number);
  return m === 1 ? y! - 1 : y!;
}

/** Start and end (exclusive) of a calendar year in Sofia time. */
export const yearWindow = (year: number) => ({ from: sofiaMidnight(year, 1, 1), to: sofiaMidnight(year + 1, 1, 1) });

export const MONTHS_BG = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'] as const;

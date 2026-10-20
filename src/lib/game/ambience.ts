import { isWinter } from './winter';

/**
 * The look of the company plot at a moment (v1.3), the same for everyone:
 * evening and night by the hour in Sofia (20:00–6:00), rain on about a third
 * of the days in autumn and spring, falling leaves in October. Snow comes
 * with the winter season (isWinter). Cosmetic only.
 */
export const AMBIENCE = { nightFrom: 20, nightTo: 6, rainShare: 0.35 } as const;

const sofia = (now: Date) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23' }).formatToParts(now).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), h: Number(parts.hour) };
};

/** A stable 0–1 number for a day (the same rain for everyone that day). */
function dayHash(y: number, m: number, d: number) {
  let h = 2166136261;
  for (const c of `${y}-${m}-${d}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

export function isNight(now: Date) {
  const { h } = sofia(now);
  return h >= AMBIENCE.nightFrom || h < AMBIENCE.nightTo;
}

/** Rain on some days of autumn (15 September – 30 November) and spring (16 March – 31 May); leaves in October. */
export function plotWeather(now: Date): 'rain' | 'leaves' | null {
  if (isWinter(now)) return null;
  const { y, m, d } = sofia(now);
  const md = m * 100 + d;
  const wet = (md >= 915 && md <= 1130) || (md >= 316 && md <= 531);
  if (wet && dayHash(y, m, d) < AMBIENCE.rainShare) return 'rain';
  return m === 10 ? 'leaves' : null;
}

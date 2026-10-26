import { t } from '@/i18n/t';
/**
 * The road in v1.6 (game data):
 * - Secure parking: the daily rest on the way in a guarded car park (a fee per
 *   rest) or a free lay-by with a small risk of fuel theft.
 * - Border queues by day and hour: Friday afternoon and Sunday evening are
 *   long, nights are short (Bulgarian time).
 * - Refuelling: the driver may fill the tank in the cheapest country on the way
 *   (as far as the tank reaches).
 * - Traffic from the players: when many trucks drive the same lane at once,
 *   it gets a little slower.
 */
export const SECURE_PARKING = {
  feeCents: 25_00,
  /** Chance of fuel theft per rest in a free lay-by, and what it costs. */
  theftChance: 0.06,
  theftCents: [120_00, 350_00] as [number, number],
} as const;

export const BORDER_QUEUE = {
  /** [weekday (0 = Sunday), from hour, to hour, factor] in Sofia time; the first match wins. */
  rules: [
    [5, 14, 20, 2],
    [0, 16, 22, 1.75],
    [-1, 0, 6, 0.6],
  ] as [number, number, number, number][],
} as const;

/** How long a border wait is at this moment, as a factor of the usual wait. */
export function borderQueueFactor(at: number) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find((p) => p.type === 'weekday')!.value);
  const h = Number(parts.find((p) => p.type === 'hour')!.value);
  for (const [day, from, to, f] of BORDER_QUEUE.rules) if ((day === -1 || day === wd) && h >= from && h < to) return f;
  return 1;
}

type Seg = { kind: string; start: number; end: number; note?: string };

/** Stretches or shortens the border waits by the hour they fall in; later segments move on. */
export function applyBorderQueues<T extends Seg>(segments: readonly T[]): T[] {
  let shift = 0;
  return segments.map((s) => {
    const seg = { ...s, start: s.start + shift, end: s.end + shift };
    if (s.kind !== 'border') return seg;
    const f = borderQueueFactor(seg.start);
    if (f === 1) return seg;
    const delta = Math.round((seg.end - seg.start) * (f - 1));
    seg.end += delta;
    shift += delta;
    seg.note = f > 1 ? t('Опашка на границата') : t('Почти празна граница');
    return seg;
  });
}

export const REFUEL = {
  /** Tank sizes (litres) by kind of power unit. */
  tankLitres: { tractor: 800, rigid: 300, van: 80 } as Record<string, number>,
} as const;

/**
 * The fuel price of a leg when the driver fills the tank in the cheapest
 * country on it: that price as far as the tank reaches, the usual mix after.
 */
export function refuelPriceCents(mixCents: number, cheapestCents: number, km: number, tankLitres: number, litresPer100: number) {
  if (km <= 0 || cheapestCents >= mixCents) return mixCents;
  const reach = (tankLitres / Math.max(1, litresPer100)) * 100;
  const share = Math.min(1, reach / km);
  return Math.round(cheapestCents * share + mixCents * (1 - share));
}

export const TRAFFIC = {
  /** Trucks on the same lane (in progress) before it gets slower. */
  from: 3,
  perTruck: 0.03,
  max: 0.15,
} as const;

/** How much slower a lane is with `n` trucks on it now (1 = free). */
export const trafficFactor = (n: number) => 1 + Math.min(TRAFFIC.max, Math.max(0, n - TRAFFIC.from + 1) * TRAFFIC.perTruck);

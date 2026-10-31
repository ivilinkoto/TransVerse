/**
 * 1.1.4.2: loads with their own rules (the contract's `tag`).
 * - Нощни куриерски линии: express parcels between big hubs, taken only at
 *   night (20:00–06:00 Sofia time), better paid.
 * - Последна миля: short city deliveries with several drops, vans only.
 * - Живи животни: a livestock trailer; good care (on time, no violations, a
 *   crew of two on long runs) pays more, poor care pays less. EU rules make
 *   long runs with animals hard — game data.
 */
export const NIGHT_COURIER = {
  from: 20,
  to: 6,
  open: 6,
  multiplier: 1.3,
  tons: [1.5, 6] as [number, number],
  minKm: 150,
  maxKm: 450,
  goods: ['Експресни пратки', 'Онлайн поръчки', 'Резервни части — спешно', 'Медицински консумативи', 'Документи и пощенски пратки'],
};

export const LAST_MILE = {
  open: 6,
  multiplier: 1.25,
  drops: 2,
  /** The whole run stays within this many km. */
  maxKm: 140,
  tons: [0.4, 1.2] as [number, number],
  goods: ['Пратки от онлайн магазини', 'Хранителни доставки', 'Аптечни доставки', 'Цветя за магазини'],
};

export const LIVESTOCK = {
  open: 5,
  multiplier: 1.2,
  tons: [8, 20] as [number, number],
  minKm: 120,
  maxKm: 650,
  /** Without a second driver a run longer than this tires the animals. */
  soloKm: 450,
  careShare: 0.15,
  poorShare: -0.1,
  goods: ['Говеда', 'Овце', 'Свине', 'Агнета', 'Коне', 'Живи пилета'],
};

export type LoadTag = 'night_courier' | 'last_mile' | 'livestock';

export const isNightCourierHour = (sofiaHour: number) => sofiaHour >= NIGHT_COURIER.from || sofiaHour < NIGHT_COURIER.to;

export const TAG_LABELS: Record<LoadTag, { label: string; emoji: string }> = {
  night_courier: { label: 'Нощен куриер', emoji: '🌙' },
  last_mile: { label: 'Последна миля', emoji: '🏙' },
  livestock: { label: 'Живи животни', emoji: '🐄' },
};

/** Whether the animals were well cared for on this run. */
export const livestockCare = (trip: { late: boolean; violations: number; loadedKm: number; team: boolean }) =>
  !trip.late && trip.violations === 0 && (trip.team || trip.loadedKm <= LIVESTOCK.soloKm);

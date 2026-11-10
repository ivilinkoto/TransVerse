/**
 * 1.3 „Талисман в кабината“: a companion that rides with the player. It grows with
 * the trips (levels 1–10), has a mood that falls when the trucks stand still, and
 * pays a small share of each delivery while it is in a good mood — twice as much
 * on its favourite kind of trip. Game data.
 */
export type MascotKind = 'cat' | 'dog' | 'parrot' | 'turtle';

export interface MascotDef {
  label: string;
  /** The default name the player can change. */
  name: string;
  emoji: string;
  /** Its favourite kind of trip (the bonus is doubled). */
  favourite: string;
  colour: string;
}

export const MASCOTS: Record<MascotKind, MascotDef> = {
  cat: { label: 'Котка', name: 'Мърка', emoji: '🐱', favourite: 'Нощни доставки (22:00–06:00)', colour: '#f59e0b' },
  dog: { label: 'Куче', name: 'Шаро', emoji: '🐶', favourite: 'Дълги курсове (над 800 км)', colour: '#a16207' },
  parrot: { label: 'Папагал', name: 'Бъбривко', emoji: '🦜', favourite: 'Курсове до друга държава', colour: '#22c55e' },
  turtle: { label: 'Костенурка', name: 'Бавко', emoji: '🐢', favourite: 'Тежки товари (над 20 т)', colour: '#14b8a6' },
};
export const MASCOT_KINDS = Object.keys(MASCOTS) as MascotKind[];

export const MASCOT = {
  nameMax: 16,
  /** Trips needed to reach each level (level 1 from the start). */
  levels: [0, 5, 15, 30, 50, 80, 120, 170, 230, 300],
  /** Mood: each delivery adds, each day without one takes away; below `sadBelow` no bonus. */
  mood: { start: 70, perTrip: 8, perPet: 5, perIdleDay: 15, sadBelow: 30 },
  /** Petting: once every so many hours. */
  petEveryHours: 4,
  /** The bonus, as a share of the reward, by level (doubled on the favourite trip). */
  bonus: (level: number) => (level >= 10 ? 0.03 : level >= 7 ? 0.02 : level >= 4 ? 0.015 : 0.01),
} as const;

export type Accessory = 'scarf' | 'cap' | 'glasses' | 'crown';
export const ACCESSORIES: Record<Accessory, { label: string; level: number }> = {
  scarf: { label: 'Шал', level: 3 },
  cap: { label: 'Шапка', level: 5 },
  glasses: { label: 'Очила', level: 8 },
  crown: { label: 'Корона', level: 10 },
};

export interface MascotState {
  kind: MascotKind;
  name: string;
  trips: number;
  mood: number;
  /** When the mood was last set (it falls from here, a day at a time). */
  moodAt: string;
  pettedAt: string | null;
  accessory: Accessory | null;
  adoptedAt: string;
}

export function mascotLevel(trips: number): number {
  let level = 1;
  MASCOT.levels.forEach((need, i) => {
    if (trips >= need) level = i + 1;
  });
  return level;
}

/** Trips to the next level (null at the top). */
export function tripsToNext(trips: number): { need: number; from: number } | null {
  const level = mascotLevel(trips);
  if (level >= MASCOT.levels.length) return null;
  return { need: MASCOT.levels[level]!, from: MASCOT.levels[level - 1]! };
}

/** The mood now: the stored one, less a step for every full day since it was set. */
export function moodNow(st: Pick<MascotState, 'mood' | 'moodAt'>, now: Date): number {
  const days = Math.floor((now.getTime() - new Date(st.moodAt).getTime()) / 86_400_000);
  return Math.max(0, Math.min(100, st.mood - Math.max(0, days) * MASCOT.mood.perIdleDay));
}

/** Is this trip the mascot's favourite kind? */
export function favouriteTrip(kind: MascotKind, f: { loadedKm: number; tons: number; originCountry: string; destCountry: string; sofiaHour: number }): boolean {
  switch (kind) {
    case 'cat':
      return f.sofiaHour >= 22 || f.sofiaHour < 6;
    case 'dog':
      return f.loadedKm >= 800;
    case 'parrot':
      return f.originCountry !== f.destCountry;
    case 'turtle':
      return f.tons >= 20;
  }
}

/** The mascot's share of a delivery's reward, in cents (0 when it is sad). */
export function mascotBonusCents(st: MascotState, rewardCents: number, favourite: boolean, now: Date): number {
  if (rewardCents <= 0 || moodNow(st, now) < MASCOT.mood.sadBelow) return 0;
  return Math.round(rewardCents * MASCOT.bonus(mascotLevel(st.trips)) * (favourite ? 2 : 1));
}

/** One line, no control characters, single spaces, at most MASCOT.nameMax characters. */
export function cleanMascotName(raw: string): string | null {
  const name = [...raw.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, MASCOT.nameMax).join('').trim();
  return name.length >= 2 ? name : null;
}

/** A word for the mood (for the card). */
export function moodWord(mood: number): string {
  return mood >= 80 ? 'Щастлив' : mood >= 55 ? 'Доволен' : mood >= MASCOT.mood.sadBelow ? 'Скучае' : 'Тъжен';
}

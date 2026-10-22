/**
 * Truck cosmetics (v1.4): parts bolted on a truck — a grille finish, a roof
 * light bar, a sun visor and a sticker with the company's name. Bought with
 * ТрансКоин, one part at a time; they stay on the truck (a new style of a
 * part replaces the old one). Original fictional designs, no real brands.
 */

export type CosmeticPart = 'grille' | 'lights' | 'visor' | 'sticker';

export interface Cosmetics {
  grille?: 'chrome' | 'black' | 'gold';
  lights?: 'amber' | 'white' | 'blue';
  visor?: 'chrome' | 'body' | 'black';
  /** Text on the cab door: the company's name (set when bought). */
  sticker?: string;
  /** Баба Марта (March): a martenitsa on the mirror — not sold, the season puts it on. */
  martenitsa?: boolean;
}

export const COSMETIC_PARTS: Record<CosmeticPart, { label: string; price: number; styles: { id: string; label: string }[] }> = {
  grille: { label: 'Решетка', price: 60, styles: [{ id: 'chrome', label: 'Хром' }, { id: 'black', label: 'Черна' }, { id: 'gold', label: 'Златна' }] },
  lights: { label: 'Светлини на покрива', price: 80, styles: [{ id: 'amber', label: 'Оранжеви' }, { id: 'white', label: 'Бели' }, { id: 'blue', label: 'Сини' }] },
  visor: { label: 'Сенник', price: 50, styles: [{ id: 'chrome', label: 'Хром' }, { id: 'body', label: 'В цвета на камиона' }, { id: 'black', label: 'Черен' }] },
  sticker: { label: 'Стикер с името на компанията', price: 70, styles: [{ id: 'on', label: 'На вратата' }] },
};

export const COSMETIC_IDS = Object.keys(COSMETIC_PARTS) as CosmeticPart[];

/** "grille:chrome" → the part and the style, if both are valid. */
export function parseCosmetic(value: string): { part: CosmeticPart; style: string } | null {
  const [part, style] = value.split(':') as [CosmeticPart, string];
  const def = COSMETIC_PARTS[part];
  return def && def.styles.some((s) => s.id === style) ? { part, style } : null;
}

/** The sticker text: the company's name, short enough for a door. */
export const stickerText = (name: string) => name.trim().toUpperCase().slice(0, 16);

export const LIGHT_COLORS: Record<NonNullable<Cosmetics['lights']>, string> = { amber: '#f59e0b', white: '#f8fafc', blue: '#38bdf8' };
export const GRILLE_COLORS: Record<NonNullable<Cosmetics['grille']>, string> = { chrome: '#e2e8f0', black: '#0b1220', gold: '#eab308' };

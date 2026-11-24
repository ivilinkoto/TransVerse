/**
 * Truck cosmetics (v1.4): parts bolted on a truck — a grille finish, a roof
 * light bar, a sun visor and a sticker with the company's name. Bought with
 * ТрансКоин, one part at a time; they stay on the truck (a new style of a
 * part replaces the old one). Original fictional designs, no real brands.
 */

export type CosmeticPart = 'grille' | 'lights' | 'visor' | 'sticker' | 'rims' | 'stacks' | 'bullbar' | 'stripes' | 'twotone' | 'aero' | 'emblem';

export interface Cosmetics {
  grille?: 'chrome' | 'black' | 'gold';
  lights?: 'amber' | 'white' | 'blue';
  visor?: 'chrome' | 'body' | 'black';
  /** Text on the cab door: the company's name (set when bought). */
  sticker?: string;
  /** 1.3.2.3 „Части по марки“: rims (instead of the brand's), exhaust stacks, a bull bar, cab stripes, a two-tone cab, the aero kit and the crown. */
  rims?: 'steel' | 'alloy' | 'heavy' | 'aero' | 'black' | 'gold';
  stacks?: 'chrome' | 'black';
  bullbar?: 'chrome' | 'black';
  stripes?: 'racing' | 'flame' | 'gold';
  twotone?: 'black' | 'white' | 'silver';
  aero?: 'on';
  emblem?: 'crown';
  /** Баба Марта (March): a martenitsa on the mirror — not sold, the season puts it on. */
  martenitsa?: boolean;
  /** 1.3.2.2: a premium truck's trim — gold pinstripes and a crown on the door (not sold, the model has it). */
  premium?: boolean;
  /** 1.2.3.5: tuning parts on the truck now (looks only), e.g. { spoiler: 'high' }. */
  tuning?: Partial<Record<'spoiler' | 'skirts' | 'bullbar' | 'exhaust' | 'rims' | 'stance' | 'decal', string>>;
  /** Tuning styles bought for this truck ("spoiler:high") — put back on for free. */
  owned?: string[];
  /** Saved tuning sets. */
  presets?: { name: string; tuning: Partial<Record<'spoiler' | 'skirts' | 'bullbar' | 'exhaust' | 'rims' | 'stance' | 'decal', string>> }[];
}

export interface CosmeticPartDef {
  label: string;
  price: number;
  styles: { id: string; label: string; /** Only from this VIP level (1.3.2.3). */ vip?: number }[];
  /** Sold from this feature on (1.3.2.3: `brand_parts`). */
  feature?: 'brand_parts';
  /** Only on tractors (stacks behind the cab, the aero kit). */
  tractorOnly?: boolean;
  /** Not on electric trucks (exhaust stacks). */
  noElectric?: boolean;
}

export const COSMETIC_PARTS: Record<CosmeticPart, CosmeticPartDef> = {
  grille: { label: 'Решетка', price: 60, styles: [{ id: 'chrome', label: 'Хром' }, { id: 'black', label: 'Черна' }, { id: 'gold', label: 'Златна' }] },
  lights: { label: 'Светлини на покрива', price: 80, styles: [{ id: 'amber', label: 'Оранжеви' }, { id: 'white', label: 'Бели' }, { id: 'blue', label: 'Сини' }] },
  visor: { label: 'Сенник', price: 50, styles: [{ id: 'chrome', label: 'Хром' }, { id: 'body', label: 'В цвета на камиона' }, { id: 'black', label: 'Черен' }] },
  sticker: { label: 'Стикер с името на компанията', price: 70, styles: [{ id: 'on', label: 'На вратата' }] },
  rims: { label: 'Джанти', price: 80, feature: 'brand_parts', styles: [{ id: 'steel', label: 'Стоманени' }, { id: 'alloy', label: 'Алуминиеви' }, { id: 'heavy', label: 'Тежкотоварни' }, { id: 'aero', label: 'Аеро капаци' }, { id: 'black', label: 'Черни' }, { id: 'gold', label: 'Златни', vip: 2 }] },
  stacks: { label: 'Ауспуси зад кабината', price: 120, feature: 'brand_parts', tractorOnly: true, noElectric: true, styles: [{ id: 'chrome', label: 'Хромирани' }, { id: 'black', label: 'Черни' }] },
  bullbar: { label: 'Бикбар', price: 100, feature: 'brand_parts', styles: [{ id: 'chrome', label: 'Хромиран' }, { id: 'black', label: 'Черен' }] },
  stripes: { label: 'Ленти по кабината', price: 90, feature: 'brand_parts', styles: [{ id: 'racing', label: 'Състезателни' }, { id: 'flame', label: 'Пламъци' }, { id: 'gold', label: 'Златни', vip: 4 }] },
  twotone: { label: 'Двуцветна кабина', price: 150, feature: 'brand_parts', styles: [{ id: 'black', label: 'Черен низ' }, { id: 'white', label: 'Бял низ' }, { id: 'silver', label: 'Сребърен низ' }] },
  aero: { label: 'Аеро пакет', price: 200, feature: 'brand_parts', tractorOnly: true, styles: [{ id: 'on', label: 'Спойлер и поли' }] },
  emblem: { label: 'Корона на вратата', price: 300, feature: 'brand_parts', styles: [{ id: 'crown', label: 'Златна корона', vip: 5 }] },
};

/** 1.3.2.3: the VIP level a part's style needs (0: none). */
export const cosmeticVip = (part: CosmeticPart, style: string) => COSMETIC_PARTS[part].styles.find((s) => s.id === style)?.vip ?? 0;
export const TWOTONE_COLORS: Record<NonNullable<Cosmetics['twotone']>, string> = { black: '#0b1220', white: '#f1f5f9', silver: '#94a3b8' };

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

/** Trailer looks (v1.5), bought with ТрансКоин like the truck parts. */
export type TrailerCosmeticPart = 'paint' | 'stripe' | 'flaps' | 'toplights';

export interface TrailerCosmetics {
  /** Body colour (hex) of curtain, box and reefer bodies. */
  paint?: string;
  stripe?: 'red' | 'blue' | 'gold';
  flaps?: 'black' | 'chrome' | 'red';
  toplights?: 'amber' | 'white';
}

export const TRAILER_COSMETIC_PARTS: Record<TrailerCosmeticPart, { label: string; price: number; styles: { id: string; label: string }[] }> = {
  paint: { label: 'Боя на ремаркето', price: 60, styles: [{ id: '#f8fafc', label: 'Бяла' }, { id: '#b91c1c', label: 'Червена' }, { id: '#1d4ed8', label: 'Синя' }, { id: '#15803d', label: 'Зелена' }, { id: '#111827', label: 'Черна' }, { id: '#ea580c', label: 'Оранжева' }] },
  stripe: { label: 'Лента по ремаркето', price: 40, styles: [{ id: 'red', label: 'Червена' }, { id: 'blue', label: 'Синя' }, { id: 'gold', label: 'Златна' }] },
  flaps: { label: 'Калници', price: 30, styles: [{ id: 'black', label: 'Черни' }, { id: 'chrome', label: 'Хромирани' }, { id: 'red', label: 'Червени' }] },
  toplights: { label: 'Светлини на покрива', price: 50, styles: [{ id: 'amber', label: 'Оранжеви' }, { id: 'white', label: 'Бели' }] },
};

export const TRAILER_COSMETIC_IDS = Object.keys(TRAILER_COSMETIC_PARTS) as TrailerCosmeticPart[];

export function parseTrailerCosmetic(value: string): { part: TrailerCosmeticPart; style: string } | null {
  const i = value.indexOf(':');
  const part = value.slice(0, i) as TrailerCosmeticPart;
  const style = value.slice(i + 1);
  const def = TRAILER_COSMETIC_PARTS[part];
  return def && def.styles.some((s) => s.id === style) ? { part, style } : null;
}

export const STRIPE_COLORS: Record<NonNullable<TrailerCosmetics['stripe']>, string> = { red: '#dc2626', blue: '#2563eb', gold: '#eab308' };

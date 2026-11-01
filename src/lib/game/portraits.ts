import { hash } from './missions';

/**
 * 1.2 „Портрети“: every driver gets a drawn portrait made of parts, chosen
 * from the driver's id — the same face forever. Invented faces, never real
 * people. The face is the same every time.
 */
export const SKIN = ['#f5d0b5', '#eec1a0', '#e0a882', '#c98e66', '#a8714f', '#7d5238'];
export const HAIR_COLORS = ['#1f1611', '#3b2618', '#6b4226', '#a0702f', '#c9a15a', '#8a8a8a', '#d6d3d1', '#7c2d12'];
export const JACKETS = ['#ea580c', '#2563eb', '#16a34a', '#7c3aed', '#0f766e', '#be123c', '#475569', '#ca8a04'];

export interface Face {
  skin: string;
  hairColor: string;
  jacket: string;
  hair: number;
  beard: number;
  brows: number;
  female: boolean;
}

/** A surname ending in -а/-я is a woman's in Bulgarian (Петрова, Илиева). */
export const isFemaleName = (name: string) => /[ая]$/i.test(name.trim().split(/\s+/).at(-1) ?? '');

export function faceFor(seed: string, name: string): Face {
  const h = (k: string) => hash(`${k}:${seed}`);
  const female = isFemaleName(name);
  return {
    skin: SKIN[h('skin') % SKIN.length]!,
    hairColor: HAIR_COLORS[h('hairc') % HAIR_COLORS.length]!,
    jacket: JACKETS[h('jacket') % JACKETS.length]!,
    hair: h('hair') % (female ? 3 : 4),
    beard: female ? 0 : h('beard') % 4,
    brows: h('brows') % 2,
    female,
  };
}

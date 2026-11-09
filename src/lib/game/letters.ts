import { t } from '@/i18n/t';

/**
 * 1.2.3.6 „Писма от клиентите“: after some deliveries the client writes — a thank-you
 * with a small bonus, a complaint about a late load, or a request for the same run
 * again (a load reserved for the player for a day, paying a little more). Game data.
 */
export const LETTERS = {
  /** Share of on-time deliveries that bring a letter. */
  chance: 0.14,
  /** Share of late deliveries that bring a complaint. */
  complaintChance: 0.35,
  /** Of the on-time letters, this share are thanks; the rest are requests. */
  thanksShare: 0.55,
  thanksBonusShare: 0.05,
  thanksMinCents: 20_00,
  thanksMaxCents: 400_00,
  requestBonus: 0.15,
  requestHours: 24,
} as const;

export type LetterKind = 'thanks' | 'complaint' | 'request';

/** A stable number in [0, 1) from a text (the same delivery always gets the same answer). */
export function roll(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1_000_000) / 1_000_000;
}

/** Which letter (if any) a delivery brings. */
export function letterKind(seed: string, late: boolean): LetterKind | null {
  const u = roll(seed);
  if (late) return u < LETTERS.complaintChance ? 'complaint' : null;
  if (u >= LETTERS.chance) return null;
  return u < LETTERS.chance * LETTERS.thanksShare ? 'thanks' : 'request';
}

export const thanksBonus = (rewardCents: number) => Math.min(LETTERS.thanksMaxCents, Math.max(LETTERS.thanksMinCents, Math.round((rewardCents * LETTERS.thanksBonusShare) / 100) * 100));

/** The letter's title and text (the client's own words). */
export function letterText(kind: LetterKind, x: { client: string; goods: string; city: string }): { title: string; body: string } {
  if (kind === 'thanks') return { title: t('✉️ Благодарствено писмо от {0}', x.client), body: t('Здравейте! „{0}“ пристигна в {1} точно и без драскотина. Благодарим — прилагаме малък бонус за шофьора.', x.goods, x.city) };
  if (kind === 'complaint') return { title: t('✉️ Оплакване от {0}', x.client), body: t('Чакахме „{0}“ в {1} по-рано и линията ни спря. Надяваме се следващия път да е навреме.', x.goods, x.city) };
  return { title: t('✉️ Покана от {0}', x.client), body: t('Работата ви хареса! Имаме още „{0}“ по същата линия до {1} — запазихме го за вас за 24 часа, с {2}% отгоре.', x.goods, x.city, Math.round(LETTERS.requestBonus * 100)) };
}

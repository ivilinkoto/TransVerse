import { sql } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { pick, randInt } from './random';

const FIRST_M = ['Иван', 'Георги', 'Димитър', 'Николай', 'Петър', 'Христо', 'Стоян', 'Тодор', 'Васил', 'Красимир', 'Йордан', 'Атанас', 'Милен', 'Стефан', 'Кирил', 'Пламен', 'Радослав', 'Калоян', 'Мартин', 'Ангел', 'Емил', 'Борислав'];
const FIRST_F = ['Мария', 'Елена', 'Десислава', 'Виктория', 'Ралица', 'Гергана', 'Надежда', 'Таня'];
const LAST = ['Иванов', 'Петров', 'Георгиев', 'Димитров', 'Николов', 'Стоянов', 'Тодоров', 'Христов', 'Колев', 'Маринов', 'Попов', 'Василев', 'Атанасов', 'Илиев', 'Ангелов', 'Костов', 'Райков', 'Цветков', 'Бонев', 'Влахов', 'Янков', 'Михайлов'];

export function driverName(): string {
  const female = randInt(0, 9) < 2;
  return female ? `${pick(FIRST_F)} ${pick(LAST)}а` : `${pick(FIRST_M)} ${pick(LAST)}`;
}

const SHIPPER_PREFIX = ['Балкан', 'Тракия', 'Дунав', 'Родопа', 'Хемус', 'Странджа', 'Пирин', 'Витоша', 'Еуро', 'Транс', 'Агро', 'Мега'];
const SHIPPER_SUFFIX = ['Трейд', 'Логистик', 'Индъстрийс', 'Фуудс', 'Груп', 'Импекс', 'Дистрибуция', 'Продукт', 'Холдинг'];

/** Fictional NPC shippers — never real companies. */
export function shipperName(): string {
  return `${pick(SHIPPER_PREFIX)} ${pick(SHIPPER_SUFFIX)} ${pick(['ООД', 'ЕООД', 'АД'])}`;
}

// Letters that look the same in Latin and Cyrillic (as on Bulgarian plates).
const PLATE_LETTERS = 'ABEKMHOPCTYX';
// Area prefixes in the style of Bulgarian registrations (fictional game plates).
const PLATE_AREAS = ['A', 'B', 'BH', 'BP', 'BT', 'E', 'EB', 'EH', 'K', 'KH', 'M', 'H', 'OB', 'P', 'PA', 'PB', 'PK', 'PP', 'C', 'CA', 'CB', 'CH', 'CM', 'CO', 'CC', 'CT', 'T', 'TX', 'X', 'Y'];
const letters = (n: number) => Array.from({ length: n }, () => PLATE_LETTERS[randInt(0, PLATE_LETTERS.length - 1)]).join('');

/**
 * A random plate such as "CA 4821 KX": 30 areas × 9 000 numbers × 144 letter
 * pairs ≈ 39 million combinations; `suffix` 3 adds ×12 more. Use `uniquePlate`
 * to get one that is not on the road yet.
 */
export function plate(suffix: 2 | 3 = 2): string {
  return `${pick(PLATE_AREAS)} ${randInt(1000, 9999)} ${letters(suffix)}`;
}

/** A plate no active vehicle or trailer has (checked in the database; 3-letter series when the 2-letter one is crowded). */
export async function uniquePlate(db: DbOrTx): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const candidate = plate(attempt < 20 ? 2 : 3);
    const { rows } = await db.execute<{ taken: boolean }>(
      sql`select exists(select 1 from vehicles where upper(plate) = ${candidate} and sold_at is null) or exists(select 1 from trailers where upper(plate) = ${candidate} and sold_at is null) or exists(select 1 from org_vehicles where upper(plate) = ${candidate} and sold_at is null) as taken`,
    );
    if (!rows[0]?.taken) return candidate;
  }
  throw new Error('could not find a free plate');
}

export const VEHICLE_COLORS = ['#1d4ed8', '#e5e7eb', '#b91c1c', '#0f766e', '#f59e0b', '#111827', '#7c3aed', '#0891b2'];

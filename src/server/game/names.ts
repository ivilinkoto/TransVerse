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

const PLATE_LETTERS = 'ABEKMHOPCTYX';
export function plate(): string {
  const l = () => PLATE_LETTERS[randInt(0, PLATE_LETTERS.length - 1)];
  return `TV ${randInt(1000, 9999)} ${l()}${l()}`;
}

export const VEHICLE_COLORS = ['#1d4ed8', '#e5e7eb', '#b91c1c', '#0f766e', '#f59e0b', '#111827', '#7c3aed', '#0891b2'];

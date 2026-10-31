import { hash } from './missions';
import { seededRandom } from './road-events';

/**
 * 1.1.4.2 „Изгубена пратка“: rarely a pallet goes missing after a trip. Three
 * clues — the warehouse, the driver, the camera — each speaks about one
 * suspect: an alibi for the innocent, something odd for the culprit. Accuse
 * once: the right one returns the goods and a reward. Game data.
 */
export const LOST = {
  chance: 0.015,
  rewardCents: 600_00,
  coins: 5,
  wrongReputation: -1,
};

export const SUSPECTS = ['Складовият работник', 'Шофьорът на нощната смяна', 'Куриерът на клиента'] as const;
export const CLUES = ['warehouse', 'driver', 'camera'] as const;
export type Clue = (typeof CLUES)[number];
export const CLUE_LABELS: Record<Clue, string> = { warehouse: 'Склад', driver: 'Разпит', camera: 'Камера' };

const ALIBI: Record<Clue, string[]> = {
  warehouse: ['Подписът при товаренето е негов и броят на палетите съвпада.', 'Складовата смяна потвърждава, че е бил на рампата до края.'],
  driver: ['Тахографът показва, че е спал в кабината на паркинга.', 'Колегите го видели да вечеря в крайпътното заведение.'],
  camera: ['Камерата го показва да се качва в колата си с празни ръце.', 'На записа предава документите и си тръгва.'],
};
const ODD: Record<Clue, string[]> = {
  warehouse: ['В отчета липсва подписът му — точно при палета, който го няма.', 'Бил е на рампата час след края на смяната си.'],
  driver: ['Тахографът показва 20 минути спиране без причина.', 'Обяснява се объркано и сменя версията си.'],
  camera: ['Записът показва силует с палетна количка в 3:12 ч.', 'Камерата е изключена точно за 15 минути.'],
};

/** The case's seed — small enough for an integer column (a raw 32-bit hash is not). */
export const caseSeed = (deliveryId: string) => hash(`seed:${deliveryId}`) % 1_000_000;

/** The culprit of a case (an index into SUSPECTS). */
export const culpritOf = (seed: number) => Math.abs(seed) % SUSPECTS.length;

/** What a clue tells: about suspect i (clue i), an alibi or something odd. */
export function clueText(seed: number, clue: Clue): { suspect: number; text: string; odd: boolean } {
  const i = CLUES.indexOf(clue);
  const odd = culpritOf(seed) === i;
  const lines = (odd ? ODD : ALIBI)[clue];
  const r = seededRandom(`lost:${seed}:${clue}`)();
  return { suspect: i, odd, text: lines[Math.floor(r * lines.length)]! };
}

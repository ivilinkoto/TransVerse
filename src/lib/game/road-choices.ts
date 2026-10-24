/**
 * Решения в движение (v1.10): now and then, half-way through a trip, the
 * driver has to choose. The player has 20 minutes; without an answer the
 * second (calm) option goes. Effects: a delay or time saved, an extra cost
 * or a bonus (shares of the load's pay), a little XP; some are a gamble.
 */
export interface ChoiceOption {
  label: string;
  /** What happens, told after the choice. */
  result: string;
  delayMin?: number;
  saveMin?: number;
  costShare?: number;
  bonusShare?: number;
  xpShare?: number;
  /** A gamble: with this chance the other outcome (`miss`) happens. */
  gamble?: { chance: number; delayMin?: number; saveMin?: number; result: string };
}

export interface ChoiceScenario {
  id: string;
  emoji: string;
  title: string;
  text: string;
  a: ChoiceOption;
  b: ChoiceOption;
}

export const ROAD_CHOICES: ChoiceScenario[] = [
  {
    id: 'jam', emoji: '🚗', title: 'Задръстване напред', text: 'Навигацията показва 8 км колона след следващия изход.',
    a: { label: 'Обходен път през селата', result: 'Мина по тесните пътища — по-бързо, но с повече гориво.', saveMin: 15, costShare: 0.02 },
    b: { label: 'Изчакай в колоната', result: 'Изчака търпеливо в колоната.', delayMin: 25 },
  },
  {
    id: 'storm', emoji: '⛈️', title: 'Буря по пътя', text: 'Небето почерня, по радиото предупреждават за градушка.',
    a: { label: 'Продължи внимателно', result: 'Бурята те подмина — нищо не загуби.', gamble: { chance: 0.35, delayMin: 50, result: 'Градушката те хвана — спря под един надлез за близо час.' } },
    b: { label: 'Спри на паркинг до отминаване', result: 'Изчака бурята на сигурно място.', delayMin: 30 },
  },
  {
    id: 'cafe', emoji: '☕', title: 'Прочутото крайпътно кафе', text: 'Колегите по CB се кълнат, че баницата тук е най-добрата по целия път.',
    a: { label: 'Спри за кафе и баница', result: 'Почина си и научи две-три пътни хитрини от колегите.', delayMin: 20, xpShare: 0.1 },
    b: { label: 'Карай нататък', result: 'Продължи без почивка.' },
  },
  {
    id: 'shortcut', emoji: '🗺️', title: 'Пряк път от CB радиото', text: 'Непознат шофьор предлага „пряк път, който никой не знае“.',
    a: { label: 'Пробвай прекия път', result: 'Наистина беше по-кратък!', saveMin: 25, gamble: { chance: 0.5, delayMin: 25, result: 'Пътят свърши в черен път — трябваше да се върнеш.' } },
    b: { label: 'Остани на главния път', result: 'Остана на сигурния маршрут.' },
  },
  {
    id: 'client', emoji: '📞', title: 'Клиентът звъни', text: 'Пита дали може по-рано — ще доплати, ако товарът дойде преди срока.',
    a: { label: 'Натисни газта (по закона)', result: 'Пристигаш по-рано, клиентът доплаща — горивото е повече.', saveMin: 20, bonusShare: 0.05, costShare: 0.02 },
    b: { label: 'Карай спокойно', result: 'Каза му, че ще пристигнеш в срока.' },
  },
  {
    id: 'hitch', emoji: '🔧', title: 'Колега с повреда', text: 'На аварийната лента стои камион с вдигнат капак и шофьорът маха.',
    a: { label: 'Спри и помогни', result: 'Помогна на колегата — той ти благодари и те препоръча на своя диспечер.', delayMin: 25, xpShare: 0.15, bonusShare: 0.02 },
    b: { label: 'Обади се на пътна помощ и продължи', result: 'Обади се на пътна помощ и продължи.' },
  },
];

export const CHOICES = {
  chance: 0.3,
  /** Only trips this long (game minutes) get a choice. */
  minTripMin: 60,
  windowMin: 20,
  defaultOption: 'b' as const,
};

export const scenarioById = (id: string) => ROAD_CHOICES.find((s) => s.id === id);

/** The rest of the trip after `at` takes `saveMs` less (never less than half of what was left). */
export function shrinkAfter<T extends { start: number; end: number }>(segments: readonly T[], at: number, saveMs: number): T[] {
  const end = segments.length ? segments[segments.length - 1]!.end : at;
  const left = end - at;
  if (left <= 0 || saveMs <= 0) return [...segments];
  const k = Math.max(0.5, (left - saveMs) / left);
  const t = (x: number) => (x <= at ? x : Math.round(at + (x - at) * k));
  return segments.map((s) => ({ ...s, start: t(s.start), end: t(s.end) }));
}

/** What an option does once chosen (a gamble is decided by `roll`). */
export function choiceOutcome(o: ChoiceOption, roll: number) {
  const miss = o.gamble && roll < o.gamble.chance ? o.gamble : null;
  return {
    delayMin: miss ? (miss.delayMin ?? 0) : (o.delayMin ?? 0),
    saveMin: miss ? (miss.saveMin ?? 0) : (o.saveMin ?? 0),
    result: miss ? miss.result : o.result,
    costShare: o.costShare ?? 0,
    bonusShare: o.bonusShare ?? 0,
    xpShare: o.xpShare ?? 0,
  };
}

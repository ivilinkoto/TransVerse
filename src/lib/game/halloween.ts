import { sofiaMonthDay } from './seasonal';
import { sofiaMidnight } from './missions';

/**
 * Halloween content (v1.1 "Нощта на тиквите"): holiday contracts, the
 * community event, the Halloween quests, the ghost truck and the pumpkin
 * paint. Content follows the dates only (not the admin's theme switch), so a
 * player who turned the decorations off still plays the holiday. Game data.
 */

export const HALLOWEEN = {
  year: 2026,
  key: 'halloween-2026',
  /** Content window, MM-DD inclusive (Sofia) — the same as the seasonal look. */
  from: '10-20',
  to: '11-02',
  /** Share of new market contracts (pallets and refrigerated) that are holiday loads. */
  contractShare: 0.22,
  rewardMultiplier: 1.3,
  goods: { pallets: ['Тикви за празника', 'Хелуински костюми и маски', 'Свещи и фенери', 'Празнична украса'], refrigerated: ['Хелуински сладкиши', 'Тиквени пайове', 'Шоколадови бонбони'] } as Record<string, string[]>,
  /** The community event: announced from the start of the content window, runs 24 Oct 18:00 – 1 Nov 00:00. */
  eventTemplate: 'halloween-2026',
  eventStart: { month: 10, day: 24, hour: 18 },
  eventEnd: { month: 11, day: 1, hour: 0 },
  /** Ghost truck: chance on a trip that drives through the night (22:00–06:00 Sofia). */
  ghostChance: 0.15,
  ghostCoins: 10,
  badge: 'pumpkin-2026',
  paintPrice: 80,
  pumpkinColor: '#ea580c',
} as const;

export function isHalloween(now: Date): boolean {
  const md = sofiaMonthDay(now);
  return md >= HALLOWEEN.from && md <= HALLOWEEN.to;
}

const at = (p: { month: number; day: number; hour: number }) => new Date(sofiaMidnight(HALLOWEEN.year, p.month, p.day).getTime() + p.hour * 3_600_000);

export function halloweenEventWindow() {
  return { startsAt: at(HALLOWEEN.eventStart), endsAt: at(HALLOWEEN.eventEnd) };
}

/** Hour of the day in Sofia (0–23). */
export function sofiaHour(t: Date | number): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', hour: '2-digit', hourCycle: 'h23' }).format(new Date(t)));
}

export const isNight = (t: Date | number) => {
  const h = sofiaHour(t);
  return h >= 22 || h < 6;
};

export interface HalloweenQuest {
  id: string;
  title: string;
  target: number;
  coins: number;
  cents: number;
}

/** The Halloween quests: the same for every player, once per year. All four earn the badge. */
export const HALLOWEEN_QUESTS: HalloweenQuest[] = [
  { id: 'h_loads', title: 'Достави 5 празнични товара', target: 5, coins: 30, cents: 1_000_00 },
  { id: 'h_km', title: 'Измини 1 500 км с празнични товари', target: 1_500, coins: 40, cents: 2_000_00 },
  { id: 'h_night', title: 'Пристигни с товар през нощта (22:00–06:00)', target: 1, coins: 20, cents: 0 },
  { id: 'h_ghost', title: 'Срещни призрачния камион', target: 1, coins: 25, cents: 0 },
];

export const QUEST_BADGE_COINS = 50;

export interface QuestFacts {
  holiday: boolean;
  loadedKm: number;
  arrivedAt: Date;
}

/** What a finished delivery adds to each quest. */
export function questIncrements(f: QuestFacts): Record<string, number> {
  return {
    h_loads: f.holiday ? 1 : 0,
    h_km: f.holiday ? Math.round(f.loadedKm) : 0,
    h_night: isNight(f.arrivedAt) ? 1 : 0,
    h_ghost: 0,
  };
}

export const BADGES: Record<string, { label: string; description: string }> = {
  'pumpkin-2026': { label: 'Тиквен шофьор 2026', description: 'Изпълни всички хелуински мисии в „Нощта на тиквите“ 2026.' },
  'santa-2026': { label: 'Коледен шофьор 2026', description: 'Изпълни всички коледни мисии в „Коледна треска“ 2026.' },
  'album-at': { label: 'Албум: Австрия', description: 'Достави до всичките 20 най-големи града в Австрия (колекция „Градове“).' },
  'album-bg': { label: 'Албум: България', description: 'Достави до всичките 20 най-големи града в България (колекция „Градове“).' },
  'album-de': { label: 'Албум: Германия', description: 'Достави до всичките 20 най-големи града в Германия (колекция „Градове“).' },
  'album-gr': { label: 'Албум: Гърция', description: 'Достави до всичките 20 най-големи града в Гърция (колекция „Градове“).' },
  'album-hu': { label: 'Албум: Унгария', description: 'Достави до всичките 20 най-големи града в Унгария (колекция „Градове“).' },
  'album-mk': { label: 'Албум: Северна Македония', description: 'Достави до всичките 20 най-големи града в Северна Македония (колекция „Градове“).' },
  'album-ro': { label: 'Албум: Румъния', description: 'Достави до всичките 20 най-големи града в Румъния (колекция „Градове“).' },
  'album-rs': { label: 'Албум: Сърбия', description: 'Достави до всичките 20 най-големи града в Сърбия (колекция „Градове“).' },
  'album-tr': { label: 'Албум: Турция', description: 'Достави до всичките 20 най-големи града в Турция (колекция „Градове“).' },
  'perfect-5': { label: 'Перфектна серия', description: '5 перфектни курса подред.' },
  'perfect-10': { label: 'Безупречен', description: '10 перфектни курса подред.' },
  'perfect-25': { label: 'Легенда на пътя', description: '25 перфектни курса подред.' },
  'retro-collector': { label: 'Ретро колекционер', description: 'Купи и трите ретро бои (70-те, 80-те, 90-те).' },
  'driver-of-month': { label: 'Шофьор на месеца', description: 'Най-много курсове в компанията за един месец.' },
  anniversary: { label: 'Рожден ден на компанията', description: 'Беше член на компанията в деня на годишнината ѝ.' },
  'marta-2027': { label: 'Пролетен шофьор 2027', description: 'Изпълни всички мисии на Баба Марта 2027.' },
  partner: { label: 'Верен партньор', description: 'Изпълни 5 договора с клиенти.' },
  'ghost-hunter': { label: 'Ловец на призраци', description: 'Срещна призрачния камион 3 пъти.' },
  'news-star': { label: 'Звезда на седмичника', description: 'Попадна в класациите на Седмичника.' },
  legend: { label: 'Легенда на пътя', description: 'Достигна ниво 20.' },
  mentor: { label: 'Наставник', description: 'Помогна на нов играч да стигне ниво 5.' },
  'first-brick': { label: 'Първа тухла', description: 'Беше в компанията, когато завърши първата ѝ сграда.' },
  architect: { label: 'Архитект', description: 'Беше в компанията, когато построи всички видове сгради.' },
  skyscraper: { label: 'Небостъргач', description: 'Беше в компанията, когато офисът ѝ стигна най-високото ниво.' },
  discord: { label: 'Discord шофьор', description: 'Свърза акаунта си с Discord сървъра на TransVerse.' },
  builder: { label: 'Строител', description: 'Докара 5 товара материали за строежите на компанията.' },
  duelist: { label: 'Дуелист', description: 'Спечели дуел срещу друг шофьор.' },
  'livery-star': { label: 'Ливрея на месеца', description: 'Камионът му спечели конкурса за ливрея.' },
  'team-haul': { label: 'Отборен товар', description: 'Участва в общ товар на компанията, който стигна навреме.' },
  'discord-10': { label: 'Discord ниво 10', description: 'Стигна ниво 10 в Discord сървъра — синя рамка около снимката.' },
  'discord-25': { label: 'Discord ниво 25', description: 'Стигна ниво 25 в Discord сървъра — златна рамка около снимката.' },
};

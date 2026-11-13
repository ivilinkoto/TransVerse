import type { MemberBonuses, UpgradeLevels } from './company';
import { seededRandom } from './road-events';

/**
 * 1.4 „Персонал на базата“: a company hires people for its base — a mechanic for the service,
 * a dispatcher for the logistics centre, a cook for the rest station and an instructor for the
 * training centre. Each needs its building, is paid every week from the treasury and gives every
 * member a small bonus on top of the building's; every day one of them has a short story for the
 * company chat. The names are made up. Game data.
 */
export type StaffRole = 'mechanic' | 'dispatcher' | 'cook' | 'instructor';

export const STAFF: Record<StaffRole, { label: string; emoji: string; building: keyof UpgradeLevels; buildingLabel: string; weeklyCents: number; bonus: string; stories: string[] }> = {
  mechanic: {
    label: 'Механик', emoji: '🔧', building: 'service', buildingLabel: 'Сервиз', weeklyCents: 3_000_00, bonus: 'Ремонтите са с още 5 % по-евтини.',
    stories: ['{0} смени маслото на три камиона и каза, че „на тоя мотор му трябва любов“.', '{0} намери спукан маркуч преди курса — тръгнахме без закъснение.', '{0} подреди ключовете по размер. Никой не смее да ги пипа.', '{0} цяла сутрин търси звук в кабината. Оказа се забравена тенекия.'],
  },
  dispatcher: {
    label: 'Диспечер', emoji: '📋', building: 'logistics', buildingLabel: 'Логистичен център', weeklyCents: 3_000_00, bonus: 'Курсовете плащат още 1 % повече.',
    stories: ['{0} договори по-добра цена с клиент в Пловдив.', '{0} цяла сутрин говори по два телефона едновременно.', '{0} залепи карта на Европа на стената и забоде кабарчета за всеки камион.', '{0} изпрати кафе на шофьора, който закъсня заради сняг.'],
  },
  cook: {
    label: 'Готвач', emoji: '🍲', building: 'rest', buildingLabel: 'Почивна станция', weeklyCents: 2_500_00, bonus: 'Почивката след курс е с още 5 % по-кратка.',
    stories: ['{0} сготви боб чорба — шофьорите се върнаха за допълнително.', '{0} изпече баница за целия екип.', '{0} пита кой открадна последните кюфтета. Тишина.', '{0} сложи термос с чай за нощната смяна.'],
  },
  instructor: {
    label: 'Инструктор', emoji: '🎓', building: 'training', buildingLabel: 'Учебен център', weeklyCents: 3_000_00, bonus: 'Още 3 % опит от курсовете.',
    stories: ['{0} показа на новите как се паркира ремарке на заден ход.', '{0} проведе урок по зимно каране — с вериги и много търпение.', '{0} похвали шофьор за перфектен курс навреме.', '{0} напомни на всички за почивките по тахографа.'],
  },
};
export const STAFF_ROLES = Object.keys(STAFF) as StaffRole[];

const FIRST = ['Петко', 'Стоян', 'Гергана', 'Милен', 'Даниела', 'Иво', 'Росица', 'Тодор', 'Мария', 'Кирил', 'Надя', 'Васил', 'Елица', 'Борис', 'Ралица', 'Пламен'];
const LAST_M = ['Петров', 'Колев', 'Димитров', 'Стоянов', 'Николов', 'Илиев', 'Маринов', 'Тодоров'];
const FEMALE = new Set(['Гергана', 'Даниела', 'Росица', 'Мария', 'Надя', 'Елица', 'Ралица']);

/** A made-up name for a new hire (the same for the same seed). */
export function staffName(seed: string): string {
  const r = seededRandom(`staff:${seed}`);
  const first = FIRST[Math.floor(r() * FIRST.length)]!;
  const last = LAST_M[Math.floor(r() * LAST_M.length)]!;
  return `${first} ${FEMALE.has(first) ? `${last}а` : last}`;
}

/** The members' bonuses with the base's staff on top. */
export function withStaff(b: MemberBonuses, roles: StaffRole[]): MemberBonuses {
  const has = (r: StaffRole) => roles.includes(r);
  return {
    ...b,
    repairDiscount: b.repairDiscount + (has('mechanic') ? 0.05 : 0),
    rewardMultiplier: b.rewardMultiplier + (has('dispatcher') ? 0.01 : 0),
    restCut: b.restCut + (has('cook') ? 0.05 : 0),
    xpMultiplier: b.xpMultiplier + (has('instructor') ? 0.03 : 0),
  };
}

/** The staff stay while the company has the building. */
export const staffAllowed = (role: StaffRole, upgrades: UpgradeLevels) => (upgrades[STAFF[role].building] ?? 0) > 0;

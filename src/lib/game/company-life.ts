/**
 * Company life (v1.9), game rules:
 * - Departments: up to 5 per company, each with a head and a weekly goal
 *   in tonnes; a member belongs to at most one.
 * - The assembly: one open question at a time, 2–4 answers, three days;
 *   one vote per member. A "contribution rate" question changes the rate
 *   on its own when it closes.
 * - Key clients: for each big real city (300 000+ people) the company that
 *   brought the most tonnes there last month (at least 50 t) gets its key
 *   client this month — members-only loads from that city that pay more.
 *   The clients' names are the game's own.
 * - Tradition: the company's own day — that day its members earn +5 %.
 * - Interns: a member spends three days at another company (its owner says
 *   yes); the intern earns +10 % XP and the host company gets company XP.
 * - Mergers: a company takes in another (no other members' shares, no
 *   alliance); the smaller one's members and treasury move over and it
 *   becomes a department.
 */
export const DEPARTMENTS = { max: 5, nameMax: 30, defaultGoalTons: 100 } as const;
export const ASSEMBLY = { days: 3, minOptions: 2, maxOptions: 4, questionMax: 140, optionMax: 60, rateOptions: [0.03, 0.05, 0.08, 0.1] } as const;
export const KEY_CLIENTS = { minPopulation: 300_000, minTons: 50, openLoads: 2, multiplier: 1.25, ttlHours: 12 } as const;
export const TRADITION = { bonusShare: 0.05, nameMax: 40 } as const;
export const INTERNS = { days: 3, xpBonus: 0.1, hostXpShare: 0.5 } as const;
export const LOGO = { shapes: ['circle', 'shield', 'hex', 'diamond', 'square'] as const, initialsMax: 3 } as const;

const CLIENT_KINDS = ['Търговска къща', 'Дистрибуция', 'Складове', 'Логистичен център', 'Пазари'];

/** The game's own name for a city's key client (deterministic). */
export function keyClientName(city: string, cityId: number) {
  return `${CLIENT_KINDS[cityId % CLIENT_KINDS.length]} „${city}“`;
}

/** Whether today (Sofia, MM-DD) is the company's own day. */
export const isTraditionDay = (day: string | null | undefined, todayMmDd: string) => !!day && day === todayMmDd;

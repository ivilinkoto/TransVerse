/**
 * Mentors: an experienced player (level 15+) who offers to help takes a new
 * player under their wing. While the mentorship lasts the newcomer gets +10 %
 * XP; when they reach level 5 both are rewarded once (money and ТрансКоин) and
 * the mentor gets the "Наставник" badge. Each newcomer can be rewarded once.
 */
export const MENTOR = {
  mentorLevel: 15,
  /** The newcomer's goal; they can pick a mentor only below it. */
  goalLevel: 5,
  /** A newcomer is a player whose account is at most this old. */
  newcomerDays: 14,
  maxMentees: 3,
  /** Time to reach the goal. */
  days: 30,
  xpBonus: 0.1,
  mentorCents: 20_000_00,
  mentorCoins: 20,
  menteeCents: 10_000_00,
  menteeCoins: 10,
  badge: 'mentor',
} as const;

export const isNewcomer = (u: { level: number; createdAt: Date }, now: Date) => u.level < MENTOR.goalLevel && now.getTime() - u.createdAt.getTime() <= MENTOR.newcomerDays * 86_400_000;

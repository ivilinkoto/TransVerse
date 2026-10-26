import { and, asc, desc, eq, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { money } from '@/lib/format';
import { isNewcomer, MENTOR } from '@/lib/game/mentor';
import { isOnline } from '@/lib/game/social';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { companies, deliveries, mentorships, userBadges, users } from '@/server/db/schema';
import { postCoins } from './coins';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { assertNotBlocked } from './moderation';
import { addFeed } from './feed';
import { notify } from './notify';
import { t } from '@/i18n/t';

const DAY = 86_400_000;

/** A level 15+ player offers (or stops offering) to mentor newcomers. */
export async function setMentorOpen(db: DbOrTx, userId: string, on: boolean) {
  const [u] = await db.select({ level: users.level }).from(users).where(eq(users.id, userId));
  if (on && (u?.level ?? 0) < MENTOR.mentorLevel) fail('level_too_low', t('Наставник може да бъде играч от ниво {0} нагоре.', MENTOR.mentorLevel));
  await db.update(users).set({ mentorOpen: on }).where(eq(users.id, userId));
}

const activeCount = (db: DbOrTx, mentorId: string) =>
  db.select({ n: sql<number>`count(*)::int` }).from(mentorships).where(and(eq(mentorships.mentorId, mentorId), eq(mentorships.status, 'active'))).then((r) => r[0]?.n ?? 0);

/** Mentors a newcomer can pick: open, level 15+, a free place; online first, then the most experienced. */
export async function availableMentors(db: DbOrTx, userId: string, now = new Date()) {
  const rows = await db
    .select({
      userId: users.id,
      username: users.username,
      level: users.level,
      lastSeenAt: users.lastSeenAt,
      active: sql<number>`(select count(*)::int from ${mentorships} m where m.mentor_id = ${users}.id and m.status = 'active')`,
      helped: sql<number>`(select count(*)::int from ${mentorships} m where m.mentor_id = ${users}.id and m.status = 'done')`,
    })
    .from(users)
    .where(and(eq(users.mentorOpen, true), sql`${users.level} >= ${MENTOR.mentorLevel}`, isNull(users.bannedAt), ne(users.id, userId)));
  return rows
    .filter((r) => r.active < MENTOR.maxMentees)
    .map((r) => ({ ...r, online: isOnline(r.lastSeenAt, now) }))
    .sort((a, b) => Number(b.online) - Number(a.online) || b.helped - a.helped || b.level - a.level)
    .slice(0, 20);
}

/** A newcomer picks a mentor. `ipHash` is the newcomer's network now (no mentoring your own second account). */
export async function chooseMentor(db: Database, menteeId: string, mentorId: string, ipHash: string | null, now = new Date()) {
  if (menteeId === mentorId) fail('self', t('Не можеш да си наставник сам на себе си.'));
  return db.transaction(async (tx) => {
    // The mentor's row is locked: two newcomers at once cannot take the last place together.
    const [mentor] = await tx.select({ id: users.id, username: users.username, level: users.level, open: users.mentorOpen, bannedAt: users.bannedAt, ipHash: users.signupIpHash }).from(users).where(eq(users.id, mentorId)).for('update');
    const [me] = await tx.select({ username: users.username, level: users.level, createdAt: users.createdAt, ipHash: users.signupIpHash, rewarded: sql<boolean>`exists (select 1 from ${mentorships} m where m.mentee_id = ${users.id} and m.status = 'done')` }).from(users).where(eq(users.id, menteeId));
    if (!mentor || mentor.bannedAt || !mentor.open || mentor.level < MENTOR.mentorLevel) fail('mentor_unavailable', t('Този играч не приема нови ученици.'));
    if (!me || !isNewcomer(me, now) || me.rewarded) fail('not_newcomer', t('Наставник могат да си изберат нови играчи (до {0} дни в играта и под ниво {1}).', MENTOR.newcomerDays, MENTOR.goalLevel));
    await assertNotBlocked(tx, menteeId, mentorId);
    if (mentor!.ipHash && (mentor!.ipHash === me!.ipHash || mentor!.ipHash === ipHash)) fail('same_network', t('Наставникът не може да е от същата мрежа.'), 403);
    if ((await activeCount(tx, mentorId)) >= MENTOR.maxMentees) fail('mentor_full', t('Наставникът вече има максимален брой ученици.'));
    const [row] = await tx
      .insert(mentorships)
      .values({ mentorId, menteeId, createdAt: now, endsAt: new Date(now.getTime() + MENTOR.days * DAY) })
      .onConflictDoNothing()
      .returning({ id: mentorships.id });
    if (!row) fail('has_mentor', t('Вече имаш наставник.'));
    await notify(tx, mentorId, 'success', () => t('{0} те избра за наставник', me!.username), () => t('Помогни му да стигне ниво {0} за {1} дни — тогава и двамата получавате награда.', MENTOR.goalLevel, MENTOR.days), '/game/mentor');
    return { id: row!.id };
  });
}

/** Either side ends the mentorship early (no reward). */
export async function endMentorship(db: Database, userId: string, id: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(mentorships).where(and(eq(mentorships.id, id), eq(mentorships.status, 'active'))).for('update');
    if (!m || (m.mentorId !== userId && m.menteeId !== userId)) fail('not_found', t('Наставничеството не е намерено.'), 404);
    await tx.update(mentorships).set({ status: 'ended', finishedAt: now }).where(eq(mentorships.id, m!.id));
    const other = m!.mentorId === userId ? m!.menteeId : m!.mentorId;
    const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, userId));
    await notify(tx, other, 'info', () => t('Наставничеството приключи'), () => t('{0} прекрати наставничеството.', me!.username), '/game/mentor');
  });
}

/** XP factor for a newcomer with an active mentor. */
export async function mentorXpFactor(tx: DbOrTx, userId: string, now: Date) {
  const [m] = await tx.select({ id: mentorships.id }).from(mentorships).where(and(eq(mentorships.menteeId, userId), eq(mentorships.status, 'active'), sql`${mentorships.endsAt} > ${now}`));
  return m ? 1 + MENTOR.xpBonus : 1;
}

/** On a level-up: a newcomer reaching the goal finishes the mentorship and both are rewarded (once per newcomer). */
export async function completeMentorship(tx: Tx, menteeId: string, level: number, now = new Date()) {
  if (level < MENTOR.goalLevel) return false;
  const [m] = await tx.select().from(mentorships).where(and(eq(mentorships.menteeId, menteeId), eq(mentorships.status, 'active'))).for('update');
  if (!m || m.endsAt <= now) return false;
  await tx.update(mentorships).set({ status: 'done', finishedAt: now }).where(eq(mentorships.id, m.id));
  const [[mentor], [mentee]] = await Promise.all([
    tx.select({ username: users.username }).from(users).where(eq(users.id, m.mentorId)),
    tx.select({ username: users.username }).from(users).where(eq(users.id, menteeId)),
  ]);
  // The newcomer's account first: a delivery settling right now has already locked it.
  const [menteeAccount, mentorAccount] = await Promise.all([companyForUser(tx, menteeId), companyForUser(tx, m.mentorId)]);
  await post(tx, menteeAccount.id, [{ category: 'mentor_reward', amountCents: MENTOR.menteeCents, description: t('Ниво {0} с наставник {1}', MENTOR.goalLevel, mentor!.username), idempotencyKey: `mentor:${menteeId}:mentee`, refType: 'mentorship', refId: m.id }]);
  await post(tx, mentorAccount.id, [{ category: 'mentor_reward', amountCents: MENTOR.mentorCents, description: t('Наставник на {0} до ниво {1}', mentee!.username, MENTOR.goalLevel), idempotencyKey: `mentor:${menteeId}:mentor`, refType: 'mentorship', refId: m.id }]);
  await postCoins(tx, m.mentorId, { amount: MENTOR.mentorCoins, reason: 'mentor_reward', description: t('Наставник на {0}', mentee!.username), idempotencyKey: `mentor:${menteeId}:mentor-coins` });
  await postCoins(tx, menteeId, { amount: MENTOR.menteeCoins, reason: 'mentor_reward', description: t('Ниво {0} с наставник', MENTOR.goalLevel), idempotencyKey: `mentor:${menteeId}:mentee-coins` });
  await tx.insert(userBadges).values({ userId: m.mentorId, badge: MENTOR.badge, awardedAt: now }).onConflictDoNothing();
  await addFeed(tx, { userId: m.mentorId, kind: 'mentor', text: t('изведе {0} до ниво {1} като наставник', mentee!.username, MENTOR.goalLevel) }, now);
  await notify(tx, m.mentorId, 'achievement', () => t('{0} стигна ниво {1}!', mentee!.username, MENTOR.goalLevel), () => t('Благодарим, наставнико: {0} и {1} TC са твои, а значката „Наставник“ — в профила ти.', money(MENTOR.mentorCents), MENTOR.mentorCoins), '/game/mentor');
  await notify(tx, menteeId, 'achievement', () => t('Ниво {0} с наставник!', MENTOR.goalLevel), () => t('Ти и {0} получавате награда: {1} и {2} TC за теб.', mentor!.username, money(MENTOR.menteeCents), MENTOR.menteeCoins), '/game/mentor');
  return true;
}

/** Worker: mentorships past their 30 days end without a reward. */
export async function expireMentorships(db: Database, now = new Date()) {
  const due = await db.update(mentorships).set({ status: 'expired', finishedAt: now }).where(and(eq(mentorships.status, 'active'), lte(mentorships.endsAt, now))).returning();
  for (const m of due) {
    await notify(db, m.menteeId, 'info', () => t('Наставничеството изтече'), () => t('Срокът от {0} дни мина. Продължаваш сам — успех на пътя!', MENTOR.days), '/game/mentor');
    await notify(db, m.mentorId, 'info', () => t('Наставничеството изтече'), () => t('Срокът от {0} дни мина, без ученикът да стигне ниво {1}.', MENTOR.days, MENTOR.goalLevel), '/game/mentor');
  }
  return due.length;
}

/** The mentor page: my mentor (as a newcomer) and my students (as a mentor), with progress. */
export async function mentorOverview(db: DbOrTx, userId: string, now = new Date()) {
  const [me] = await db.select({ level: users.level, createdAt: users.createdAt, mentorOpen: users.mentorOpen }).from(users).where(eq(users.id, userId));
  const trips = sql<number>`(select count(*)::int from ${deliveries} d join ${companies} c on c.id = d.company_id where c.owner_id = ${users}.id and d.status = 'completed')`;
  const [mine] = await db
    .select({ id: mentorships.id, endsAt: mentorships.endsAt, createdAt: mentorships.createdAt, userId: users.id, username: users.username, level: users.level, lastSeenAt: users.lastSeenAt })
    .from(mentorships)
    .innerJoin(users, eq(users.id, mentorships.mentorId))
    .where(and(eq(mentorships.menteeId, userId), eq(mentorships.status, 'active')));
  const students = await db
    .select({ id: mentorships.id, status: mentorships.status, endsAt: mentorships.endsAt, finishedAt: mentorships.finishedAt, userId: users.id, username: users.username, level: users.level, xp: users.xp, lastSeenAt: users.lastSeenAt, trips })
    .from(mentorships)
    .innerJoin(users, eq(users.id, mentorships.menteeId))
    .where(and(eq(mentorships.mentorId, userId), inArray(mentorships.status, ['active', 'done'])))
    .orderBy(asc(mentorships.status), desc(mentorships.createdAt))
    .limit(20);
  const [done] = await db.select({ n: sql<number>`count(*)::int` }).from(mentorships).where(and(eq(mentorships.menteeId, userId), eq(mentorships.status, 'done')));
  return {
    level: me?.level ?? 1,
    mentorOpen: me?.mentorOpen ?? false,
    canMentor: (me?.level ?? 0) >= MENTOR.mentorLevel,
    canPick: !!me && isNewcomer(me, now) && !mine && !done?.n,
    mentor: mine ? { ...mine, online: isOnline(mine.lastSeenAt, now) } : null,
    students: students.map((s) => ({ ...s, online: isOnline(s.lastSeenAt, now) })),
  };
}

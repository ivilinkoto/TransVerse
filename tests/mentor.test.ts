import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { MENTOR } from '@/lib/game/mentor';
import { xpForLevel } from '@/lib/game/progression';
import { closeDb } from '@/server/db/client';
import { companies, mentorships, userBadges, users } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { availableMentors, chooseMentor, endMentorship, expireMentorships, mentorOverview, mentorXpFactor, setMentorOpen } from '@/server/game/mentor';
import { awardXp } from '@/server/game/progression';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const balance = async (userId: string) => (await db().select({ b: companies.balanceCents }).from(companies).where(eq(companies.ownerId, userId)))[0]!.b;
const coins = async (userId: string) => (await db().select({ c: users.coins }).from(users).where(eq(users.id, userId)))[0]!.c;

async function mentor() {
  const p = await newPlayer();
  await db().update(users).set({ level: MENTOR.mentorLevel, signupIpHash: `net-${p.userId}` }).where(eq(users.id, p.userId));
  await setMentorOpen(db(), p.userId, true);
  return p;
}
async function newcomer() {
  const p = await newPlayer();
  await db().update(users).set({ signupIpHash: `net-${p.userId}` }).where(eq(users.id, p.userId));
  return p;
}

describe('mentors', () => {
  it('only level 15+ may mentor; open mentors with a free place are listed', async () => {
    const low = await newPlayer();
    expect(await code(setMentorOpen(db(), low.userId, true))).toBe('level_too_low');
    const m = await mentor();
    const n = await newcomer();
    expect((await availableMentors(db(), n.userId)).map((r) => r.userId)).toContain(m.userId);
    await setMentorOpen(db(), m.userId, false);
    expect((await availableMentors(db(), n.userId)).map((r) => r.userId)).not.toContain(m.userId);
  });

  it('a newcomer picks a mentor, gets +10 % XP, and at level 5 both are rewarded once', async () => {
    const m = await mentor();
    const n = await newcomer();
    await chooseMentor(db(), n.userId, m.userId, null);
    expect(await mentorXpFactor(db(), n.userId, new Date())).toBeCloseTo(1 + MENTOR.xpBonus);
    expect((await mentorOverview(db(), m.userId)).students).toHaveLength(1);
    expect((await availableMentors(db(), (await newcomer()).userId)).find((r) => r.userId === m.userId)?.active).toBe(1);
    expect(await code(chooseMentor(db(), n.userId, m.userId, null))).toBe('has_mentor');

    const [mBefore, nBefore] = [await balance(m.userId), await balance(n.userId)];
    await db().transaction((tx) => awardXp(tx, n.userId, xpForLevel(MENTOR.goalLevel)));
    expect(await balance(m.userId)).toBe(mBefore + MENTOR.mentorCents);
    expect(await balance(n.userId)).toBe(nBefore + MENTOR.menteeCents);
    expect(await coins(m.userId)).toBe(MENTOR.mentorCoins);
    expect(await coins(n.userId)).toBe(MENTOR.menteeCoins);
    expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, m.userId), eq(userBadges.badge, 'mentor')))).toHaveLength(1);
    const [row] = await db().select().from(mentorships).where(eq(mentorships.menteeId, n.userId));
    expect(row!.status).toBe('done');
    expect(await mentorXpFactor(db(), n.userId, new Date())).toBe(1);
    // A rewarded newcomer cannot pick another mentor.
    const m2 = await mentor();
    expect(await code(chooseMentor(db(), n.userId, m2.userId, null))).toBe('not_newcomer');
  });

  it('refuses old accounts, the same network and full mentors', async () => {
    const m = await mentor();
    const old = await newcomer();
    await db().update(users).set({ createdAt: new Date(Date.now() - (MENTOR.newcomerDays + 1) * 86_400_000) }).where(eq(users.id, old.userId));
    expect(await code(chooseMentor(db(), old.userId, m.userId, null))).toBe('not_newcomer');
    const twin = await newcomer();
    expect(await code(chooseMentor(db(), twin.userId, m.userId, `net-${m.userId}`))).toBe('same_network');
    for (let i = 0; i < MENTOR.maxMentees; i++) await chooseMentor(db(), (await newcomer()).userId, m.userId, null);
    expect(await code(chooseMentor(db(), (await newcomer()).userId, m.userId, null))).toBe('mentor_full');
  });

  it('can be ended by either side and expires after 30 days without a reward', async () => {
    const m = await mentor();
    const a = await newcomer();
    const b = await newcomer();
    const { id } = await chooseMentor(db(), a.userId, m.userId, null);
    await endMentorship(db(), a.userId, id);
    expect((await db().select().from(mentorships).where(eq(mentorships.id, id)))[0]!.status).toBe('ended');
    // Free to pick again after ending.
    await chooseMentor(db(), a.userId, m.userId, null);

    await chooseMentor(db(), b.userId, m.userId, null);
    await expireMentorships(db(), new Date(Date.now() + (MENTOR.days + 1) * 86_400_000));
    const before = await balance(m.userId);
    await db().transaction((tx) => awardXp(tx, b.userId, xpForLevel(MENTOR.goalLevel)));
    expect(await balance(m.userId)).toBe(before);
    expect((await db().select().from(mentorships).where(eq(mentorships.menteeId, b.userId)))[0]!.status).toBe('expired');
  });
});

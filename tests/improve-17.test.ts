import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { PLATE_AUCTION } from '@/lib/game/plates';
import { SPRING_CUP } from '@/lib/game/tournament';
import { closeDb } from '@/server/db/client';
import { companies, jobState, notifications, plateAuctions, recruitmentPosts, reports, tournamentEntries, tournamentMatches, trailers, users } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { reportPlayer, resolveReport } from '@/server/game/moderation';
import { bidForPlate } from '@/server/game/plates';
import { postRecruitment } from '@/server/game/recruitment';
import { joinCup, runCup } from '@/server/game/tournament';
import { endTrailerHires, hireTrailer, offerTrailer } from '@/server/game/trailer-hire';
import { adminCancelPlateAuction, adminEndTrailerHire, adminRemoveCupEntrant } from '@/server/staff-tools';
import { db, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const coins = async (userId: string) => (await db().select({ c: users.coins }).from(users).where(eq(users.id, userId)))[0]!.c;
const account = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const staff = async () => {
  const s = await newPlayer();
  await db().update(users).set({ role: 'admin' }).where(eq(users.id, s.userId));
  return { id: s.userId, role: 'admin' };
};

describe('v1.7 improvements', () => {
  it('a late bid moves the end of the plate auction; staff can stop it and the bid comes back', async () => {
    // An auction of its own (the weekly one is another test's).
    const [a] = await db().insert(plateAuctions).values({ weekKey: `T${Date.now().toString(36)}`.slice(0, 12), plate: 'TV 9', endsAt: new Date(Date.now() + 3_600_000), createdAt: new Date() }).returning();
    const p = await newPlayer();
    await db().update(users).set({ coins: 500 }).where(eq(users.id, p.userId));
    // Five minutes before the end.
    const late = new Date(a!.endsAt.getTime() - 5 * 60_000);
    const r = await bidForPlate(db(), p.userId, PLATE_AUCTION.startCoins, late, a!.weekKey);
    expect(r.endsAt.getTime()).toBe(late.getTime() + PLATE_AUCTION.extendMs);
    expect(await coins(p.userId)).toBe(500 - PLATE_AUCTION.startCoins);
    await adminCancelPlateAuction(db(), await staff(), a!.weekKey);
    expect(await coins(p.userId)).toBe(500);
    expect((await db().select().from(plateAuctions).where(eq(plateAuctions.weekKey, a!.weekKey)))[0]!.settledAt).not.toBeNull();
  });

  it('a recruitment post can be reported and the moderator deletes it', async () => {
    const author = await newPlayer();
    const reporter = await newPlayer();
    const post = await postRecruitment(db(), author.userId, { kind: 'driver', text: 'Търся компания за курсове вечер.' });
    const id = await reportPlayer(db(), reporter.userId, { targetUserId: author.userId, kind: 'recruitment', postId: post.id, reason: 'abuse' });
    const [rep] = await db().select().from(reports).where(eq(reports.id, id));
    expect(rep!.snippet).toBe(post.text);
    await resolveReport(db(), await staff(), id, 'delete_message');
    expect(await db().select().from(recruitmentPosts).where(eq(recruitmentPosts.id, post.id))).toHaveLength(0);
  });

  it('the cup is called off with fewer than two drivers; staff can take a driver off before it starts', async () => {
    await db().delete(tournamentMatches).where(eq(tournamentMatches.tournament, SPRING_CUP.key));
    await db().delete(tournamentEntries).where(eq(tournamentEntries.tournament, SPRING_CUP.key));
    await db().delete(jobState).where(eq(jobState.key, `cup-cancelled:${SPRING_CUP.key}`));
    const [a, b] = [await newPlayer(), await newPlayer()];
    for (const p of [a, b]) await db().update(users).set({ level: 5 }).where(eq(users.id, p.userId));
    const signup = new Date('2027-03-25T10:00:00Z');
    await joinCup(db(), a.userId, signup);
    await joinCup(db(), b.userId, signup);
    await adminRemoveCupEntrant(db(), await staff(), b.userId);
    await runCup(db(), new Date(SPRING_CUP.rounds[0].from.getTime() + 60_000));
    expect(await db().select().from(tournamentMatches).where(eq(tournamentMatches.tournament, SPRING_CUP.key))).toHaveLength(0);
    expect(await db().select().from(notifications).where(and(eq(notifications.userId, a.userId), eq(notifications.title, `${SPRING_CUP.title} се отменя`)))).toHaveLength(1);
    await db().delete(jobState).where(eq(jobState.key, `cup-cancelled:${SPRING_CUP.key}`));
  });

  it('a hire: a reminder before the end; staff end it and the unused days go back', async () => {
    const [owner, renter] = [await newPlayer(), await newPlayer()];
    const acc = await account(owner.userId);
    const [t] = await db().insert(trailers).values({ companyId: acc.id, modelId: 'curtain-13', plate: `R${Date.now().toString(36).slice(-6).toUpperCase()}`, cityId: owner.hq.id, purchasePriceCents: 30_000_00 }).returning();
    const offer = await offerTrailer(db(), owner.userId, { trailerId: t!.id, pricePerDayCents: 50_00, maxDays: 5 });
    const now = new Date();
    await hireTrailer(db(), renter.userId, offer.id, 5, now);
    await endTrailerHires(db(), new Date(now.getTime() + 5 * 86_400_000 - 3_600_000));
    expect(await db().select().from(notifications).where(and(eq(notifications.userId, renter.userId), eq(notifications.title, 'Наемът на ремаркето свършва скоро')))).toHaveLength(1);
    const before = (await account(renter.userId)).balanceCents;
    const r = await adminEndTrailerHire(db(), await staff(), offer.id, new Date(now.getTime() + 86_400_000 + 1000));
    expect(r.refund).toBe(3 * 50_00);
    expect((await account(renter.userId)).balanceCents).toBe(before + 3 * 50_00);
    expect((await db().select().from(trailers).where(eq(trailers.id, t!.id)))[0]!.hiredOut).toBe(false);
  });

  it('a company post needs the recruit permission; a member post is refused', async () => {
    const boss = await playerWithCompany();
    expect(await code(postRecruitment(db(), boss.userId, { kind: 'driver', text: 'Търся друга компания за курсове.' }))).toBe('member');
  });
});

import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { closeDb } from '@/server/db/client';
import { companies, recruitmentPosts, reports, users } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { reportPlayer, resolveReport } from '@/server/game/moderation';
import { postRecruitment } from '@/server/game/recruitment';
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

  it('a company post needs the recruit permission; a member post is refused', async () => {
    const boss = await playerWithCompany();
    expect(await code(postRecruitment(db(), boss.userId, { kind: 'driver', text: 'Търся друга компания за курсове.' }))).toBe('member');
  });
});

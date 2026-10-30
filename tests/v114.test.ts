import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { FEATURES } from '@/lib/game/features';
import { comingReleases, releaseByVersion, RELEASES } from '@/lib/game/releases';
import { BUDITELI, isBuditeli } from '@/lib/game/buditeli';
import { listSessions } from '@/server/auth/account-close';
import { createSession, sessionDigest } from '@/server/auth/session';
import { backupDir, runBackup } from '@/server/backup';
import { cached } from '@/server/cache';
import { closeDb } from '@/server/db/client';
import { activity, companies, deliveries, ideas, jobState, notifications, sessions, userBadges, users, vehicles } from '@/server/db/schema';
import { ERROR_LOG_SIZE, isClientAbort, recentServerErrors, recordServerError } from '@/server/error-log';
import { recordBuditeliDelivery } from '@/server/game/buditeli';
import { acceptContract } from '@/server/game/deliveries';
import { ideaBoard, setIdeaStatus, submitIdea, voteIdea } from '@/server/game/ideas';
import { myDay, sendMyDay } from '@/server/game/my-day';
import { housekeeping } from '@/server/housekeeping';
import { db, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

const userOf = async (id: string) => (await db().select().from(users).where(eq(users.id, id)))[0]!;

/** A finished trip of the player's rented truck (optionally a holiday load), completed at `at`. */
async function finishedTrip(userId: string, at: Date, holiday: string | null = null) {
  const [company] = await db().select().from(companies).where(eq(companies.ownerId, userId));
  const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, company!.id));
  await db().update(vehicles).set({ status: 'idle' }).where(eq(vehicles.id, truck!.id));
  const c = await makeContract('Sofia', 'Plovdiv', { holiday });
  const d = await acceptContract(db(), userId, c.id, truck!.id);
  await db().update(deliveries).set({ status: 'completed', completedAt: at, late: false, payoutCents: 500_00 }).where(eq(deliveries.id, d.id));
  await db().update(vehicles).set({ status: 'idle' }).where(eq(vehicles.id, truck!.id));
  return d;
}

describe('v1.1.4', () => {
  it('registers its features and release', () => {
    for (const id of ['countdowns', 'ideas', 'buditeli', 'daily_summary', 'compare_players', 'roadmap'] as const) expect(FEATURES[id]).toBe('1.1.4');
    expect(releaseByVersion('1.1.4')?.name).toBe('Вашите идеи');
  });

  it('housekeeping: expired sessions, old activity (the last sign-in device stays), old read notifications', async () => {
    const p = await newPlayer();
    const now = new Date('2031-06-01T10:00:00Z');
    const old = new Date(now.getTime() - 400 * 86_400_000);
    await db().insert(sessions).values({ id: `expired-${p.userId}`, userId: p.userId, expiresAt: new Date(now.getTime() - 1000) });
    await db().insert(activity).values([
      { userId: p.userId, action: 'login_device', details: { device: 'A' }, createdAt: old },
      { userId: p.userId, action: 'login_device', details: { device: 'B' }, createdAt: new Date(old.getTime() + 1000) },
      { userId: p.userId, action: 'something', details: {}, createdAt: old },
    ]);
    await db().insert(notifications).values([
      { userId: p.userId, kind: 'info', title: 'старо прочетено', body: '', readAt: old, createdAt: old },
      { userId: p.userId, kind: 'info', title: 'старо непрочетено', body: '', createdAt: old },
    ]);
    await housekeeping(db(), now);
    expect(await db().select().from(sessions).where(eq(sessions.id, `expired-${p.userId}`))).toHaveLength(0);
    const left = await db().select().from(activity).where(and(eq(activity.userId, p.userId), sql`${activity.createdAt} < ${new Date(now.getTime() - 180 * 86_400_000)}`));
    expect(left.map((a) => (a.details as { device?: string }).device)).toEqual(['B']);
    const titles = (await db().select().from(notifications).where(eq(notifications.userId, p.userId))).map((n) => n.title);
    expect(titles).toContain('старо непрочетено');
    expect(titles).not.toContain('старо прочетено');
  });

  it('the device list leaves out expired sessions', async () => {
    const p = await newPlayer();
    const here = await createSession(db(), p.userId);
    await db().insert(sessions).values({ id: `gone-${p.userId}`, userId: p.userId, expiresAt: new Date(Date.now() - 60_000) });
    expect(await listSessions(db(), p.userId, sessionDigest(here.token))).toHaveLength(1);
  });

  it('server errors are kept, newest first, at most 50', async () => {
    for (let i = 0; i < ERROR_LOG_SIZE + 3; i++) await recordServerError(`GET /x/${i}`, new Error(`boom ${i}`), db());
    const list = await recentServerErrors(db());
    expect(list).toHaveLength(ERROR_LOG_SIZE);
    expect(list[0]).toMatchObject({ where: `GET /x/${ERROR_LOG_SIZE + 2}`, message: `Error: boom ${ERROR_LOG_SIZE + 2}` });
  });

  it('a request the browser left mid-stream is not a server error', async () => {
    const reset = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    const abort = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
    for (const e of [new Error('The destination stream closed early.'), reset, abort, new Error('aborted')]) {
      expect(isClientAbort(e)).toBe(true);
      await recordServerError('GET /game?_rsc=1', e, db());
    }
    expect(isClientAbort(new Error('relation "x" does not exist'))).toBe(false);
    expect((await recentServerErrors(db()))[0]?.where).not.toBe('GET /game?_rsc=1');
    // Old entries of this kind are hidden as well.
    await db().update(jobState).set({ value: { items: [{ at: new Date().toISOString(), where: 'GET /game/market?_rsc=2', message: 'Error: The destination stream closed early.' }] } }).where(eq(jobState.key, 'errors:recent'));
    expect(await recentServerErrors(db())).toEqual([]);
  });

  it('no backup without a folder (development, tests); the cache keeps a value for its time', async () => {
    if (!process.env.BACKUP_DIR && !backupDir()) expect(await runBackup(db(), new Date())).toBeNull();
    let n = 0;
    const load = async () => ++n;
    expect(await cached('t:x', 1000, load, 0)).toBe(1);
    expect(await cached('t:x', 1000, load, 500)).toBe(1);
    expect(await cached('t:x', 1000, load, 1500)).toBe(2);
  });

  it('ideas: level, a daily limit, one vote each (not for one’s own), staff status with a notice', async () => {
    const author = await newPlayer();
    const voter = await newPlayer();
    await expect(submitIdea(db(), author.userId, { title: 'Повече фериботи', body: '' })).rejects.toThrow();
    await db().update(users).set({ level: 2 }).where(eq(users.id, author.userId));
    const idea = await submitIdea(db(), author.userId, { title: 'Повече фериботи', body: 'До Крит.' });
    await submitIdea(db(), author.userId, { title: 'Нощен режим', body: '' });
    await submitIdea(db(), author.userId, { title: 'Камион-цистерна', body: '' });
    await expect(submitIdea(db(), author.userId, { title: 'Четвърта идея', body: '' })).rejects.toThrow();
    await expect(voteIdea(db(), author.userId, idea.id)).rejects.toThrow();
    expect(await voteIdea(db(), voter.userId, idea.id)).toEqual({ voted: true, votes: 1 });
    expect(await voteIdea(db(), voter.userId, idea.id)).toEqual({ voted: false, votes: 0 });
    await voteIdea(db(), voter.userId, idea.id);
    const board = await ideaBoard(db(), voter.userId, 'top');
    expect(board.find((i) => i.id === idea.id)).toMatchObject({ votes: 1, votedByMe: true, mine: false });
    await expect(setIdeaStatus(db(), { id: voter.userId, role: 'player' }, idea.id, 'planned', '')).rejects.toThrow();
    const staff = await newPlayer();
    await db().update(users).set({ role: 'admin' }).where(eq(users.id, staff.userId));
    await setIdeaStatus(db(), { id: staff.userId, role: 'admin' }, idea.id, 'planned', 'В 1.3.');
    expect((await db().select().from(notifications).where(and(eq(notifications.userId, author.userId), eq(notifications.href, '/game/ideas')))).length).toBe(1);
    await setIdeaStatus(db(), { id: staff.userId, role: 'admin' }, idea.id, 'hidden', '');
    expect((await ideaBoard(db(), voter.userId, 'new')).some((i) => i.id === idea.id)).toBe(false);
    expect((await ideaBoard(db(), staff.userId, 'new', true)).some((i) => i.id === idea.id)).toBe(true);
    void ideas;
  });

  it('Ден на будителите: the dates, and the third load of books brings the badge and coins once', async () => {
    expect(isBuditeli(new Date('2026-11-01T09:00:00+02:00'))).toBe(true);
    expect(isBuditeli(new Date('2026-11-02T22:00:00+02:00'))).toBe(true);
    expect(isBuditeli(new Date('2026-11-03T09:00:00+02:00'))).toBe(false);
    const p = await newPlayer();
    const coins0 = (await userOf(p.userId)).coins;
    const at = new Date('2026-11-01T12:00:00+02:00');
    for (let i = 0; i < BUDITELI.forBadge - 1; i++) await finishedTrip(p.userId, at, 'buditeli');
    expect(await db().transaction((tx) => recordBuditeliDelivery(tx, p.userId, at))).toBe(false);
    await finishedTrip(p.userId, at, 'buditeli');
    expect(await db().transaction((tx) => recordBuditeliDelivery(tx, p.userId, at))).toBe(true);
    expect(await db().transaction((tx) => recordBuditeliDelivery(tx, p.userId, at))).toBe(false);
    expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, p.userId), eq(userBadges.badge, 'buditeli-2026')))).toHaveLength(1);
    expect((await userOf(p.userId)).coins).toBe(coins0 + BUDITELI.coins);
  });

  it('Моят ден: today’s trips, sent only to players who switched it on', async () => {
    const on = await newPlayer();
    const off = await newPlayer();
    const now = new Date();
    await finishedTrip(on.userId, now);
    await finishedTrip(off.userId, now);
    expect(await myDay(db(), on.userId, now)).toMatchObject({ trips: 1, cents: 500_00, late: 0 });
    await db().update(users).set({ uiPrefs: { dailySummary: true } }).where(eq(users.id, on.userId));
    await sendMyDay(db(), now);
    const got = async (id: string) => (await db().select().from(notifications).where(and(eq(notifications.userId, id), sql`${notifications.title} like 'Моят ден%'`))).length;
    expect(await got(on.userId)).toBe(1);
    expect(await got(off.userId)).toBe(0);
  });

  it('what is coming: future releases, nearest first, never a published one', () => {
    const now = new Date('2026-10-30T10:00:00+02:00');
    const coming = comingReleases(now);
    expect(coming[0]?.version).toBe('1.1.4');
    expect(comingReleases(new Date('2026-10-28T12:00:00+02:00')).map((r) => r.version).slice(0, 3)).toEqual(['1.1.3.1', '1.1.3.2', '1.1.3.3']);
    expect(coming.every((r) => new Date(r.publishedAt) > now)).toBe(true);
    expect(coming.length).toBeLessThanOrEqual(3);
    expect(RELEASES.length).toBeGreaterThan(coming.length);
  });
});

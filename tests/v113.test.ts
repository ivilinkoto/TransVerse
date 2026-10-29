import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { FEATURES } from '@/lib/game/features';
import { upcomingRelease } from '@/lib/game/releases';
import { authenticate } from '@/server/auth/accounts';
import { cancelDeletion, eraseAccount, listSessions, pendingDeletion, requestAccountDeletion, runDueDeletions, signOutOthers, signOutSession } from '@/server/auth/account-close';
import { changeUsername, exportAccount } from '@/server/auth/account-data';
import { afterLogin, loginHistory } from '@/server/auth/login-events';
import { pushActionsFor } from '@/server/push';
import { deviceLabel } from '@/lib/device';
import { createLinkToken, verifyEmail } from '@/server/auth/email-links';
import { EMAIL_REWARD_COINS, rewardEarlierVerified } from '@/server/auth/email-reward';
import { createSession, sessionDigest } from '@/server/auth/session';
import { activeBroadcast, postBroadcastToDiscord, setBroadcast } from '@/server/broadcast';
import { closeDb } from '@/server/db/client';
import { companies, contracts, deliveries, notifications, organizations, seasonalQuests, sessions, users, vehicles } from '@/server/db/schema';
import { acceptContract } from '@/server/game/deliveries';
import { HALLOWEEN_DEF } from '@/server/game/halloween';
import { remindUnclaimedHoliday, unclaimedHolidayQuests } from '@/server/game/holiday';
import { firstOwnTruck, FIRST_OWN_TRUCK_AFTER, recentTrips, sameLaneAgain } from '@/server/game/overview';
import { db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const userOf = async (id: string) => (await db().select().from(users).where(eq(users.id, id)))[0]!;
const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;

describe('v1.1.3', () => {
  it('registers its features under 1.1.3', () => {
    for (const id of ['rent_vs_buy', 'help_faq', 'notification_filter', 'next_update', 'depot_on_market', 'first_own_truck', 'delete_account', 'sign_out_others', 'email_reward', 'recent_trips', 'arrival_sound', 'session_list', 'data_export', 'login_alert', 'username_change', 'truck_compare', 'sound_settings'] as const) expect(FEATURES[id]).toBe('1.1.3');
  });

  it('after the Halloween event, players with finished quests not taken get one reminder', async () => {
    const p = await newPlayer();
    const [first, second] = HALLOWEEN_DEF.quests;
    await db().insert(seasonalQuests).values([
      { userId: p.userId, quest: `${HALLOWEEN_DEF.key}:${first!.id}`, progress: first!.target },
      { userId: p.userId, quest: `${HALLOWEEN_DEF.key}:${second!.id}`, progress: 0 },
    ]);
    expect((await unclaimedHolidayQuests(db(), HALLOWEEN_DEF, p.userId)).get(p.userId)).toBe(1);

    const end = HALLOWEEN_DEF.eventWindow().endsAt.getTime();
    const mine = async () => (await db().select().from(notifications).where(and(eq(notifications.userId, p.userId), eq(notifications.href, HALLOWEEN_DEF.href)))).length;
    // Before the end and after the week: nothing.
    await remindUnclaimedHoliday(db(), HALLOWEEN_DEF, new Date(end - 60_000));
    await remindUnclaimedHoliday(db(), HALLOWEEN_DEF, new Date(end + 8 * 86_400_000));
    expect(await mine()).toBe(0);
    await remindUnclaimedHoliday(db(), HALLOWEEN_DEF, new Date(end + 3_600_000));
    expect(await mine()).toBe(1);

    // Taken: no longer counted.
    await db().update(seasonalQuests).set({ claimedAt: new Date() }).where(eq(seasonalQuests.userId, p.userId));
    expect((await unclaimedHolidayQuests(db(), HALLOWEEN_DEF, p.userId)).get(p.userId)).toBeUndefined();
  });

  it('the countdown shows the next release within two weeks', () => {
    expect(upcomingRelease(new Date('2026-11-01T10:00:00+02:00'))?.version).toBe('1.2');
    expect(upcomingRelease(new Date('2026-10-28T10:00:00+02:00'))?.version).toBe('1.1.3.1');
    expect(upcomingRelease(new Date('2026-10-29T21:30:00+02:00'))?.version).toBe('1.1.4');
    expect(upcomingRelease(new Date('2026-10-26T18:00:00+02:00'))?.version).toBe('1.1.3');
    expect(upcomingRelease(new Date('2026-10-01T10:00:00+03:00'))).toBeNull();
  });

  it('the team message: administrators set it, it ends by itself or when taken down', async () => {
    const admin = await newPlayer();
    await db().update(users).set({ role: 'admin' }).where(eq(users.id, admin.userId));
    const player = await newPlayer();
    const now = new Date('2031-05-01T10:00:00Z');
    await expect(setBroadcast(db(), { id: player.userId, role: 'player' }, { text: 'Хей', tone: 'info', hours: 1 }, now)).rejects.toThrow();
    await setBroadcast(db(), { id: admin.userId, role: 'admin' }, { text: 'Поддръжка в 22:00', tone: 'warning', hours: 2 }, now);
    expect(await activeBroadcast(db(), now)).toMatchObject({ text: 'Поддръжка в 22:00', tone: 'warning' });
    expect(await activeBroadcast(db(), new Date(now.getTime() + 3 * 3_600_000))).toBeNull();
    await setBroadcast(db(), { id: admin.userId, role: 'admin' }, { text: '', hours: 1 }, now);
    expect(await activeBroadcast(db(), now)).toBeNull();
    // Scheduled: not before its time; posted to Discord once when it starts.
    const later = new Date(now.getTime() + 5 * 3_600_000);
    await setBroadcast(db(), { id: admin.userId, role: 'admin' }, { text: 'Ивент в 15:00', hours: 2, startsAt: later.toISOString(), discord: true }, now);
    expect(await activeBroadcast(db(), now)).toBeNull();
    expect(await postBroadcastToDiscord(db(), now)).toBe(false);
    expect(await activeBroadcast(db(), new Date(later.getTime() + 60_000))).toMatchObject({ text: 'Ивент в 15:00' });
    expect(await postBroadcastToDiscord(db(), new Date(later.getTime() + 60_000))).toBe(true);
    expect(await postBroadcastToDiscord(db(), new Date(later.getTime() + 120_000))).toBe(false);
    expect(await activeBroadcast(db(), new Date(later.getTime() + 3 * 3_600_000))).toBeNull();
  });

  it('a confirmed e-mail pays ТрансКоин once, earlier confirmations too', async () => {
    const p = await newPlayer();
    const coins0 = (await userOf(p.userId)).coins;
    await verifyEmail(db(), await createLinkToken(db(), p.userId, 'verify'));
    expect((await userOf(p.userId)).coins).toBe(coins0 + EMAIL_REWARD_COINS);
    // A new address confirmed again: no second reward.
    await db().update(users).set({ emailVerifiedAt: null }).where(eq(users.id, p.userId));
    await verifyEmail(db(), await createLinkToken(db(), p.userId, 'verify'));
    expect((await userOf(p.userId)).coins).toBe(coins0 + EMAIL_REWARD_COINS);

    const early = await newPlayer();
    const early0 = (await userOf(early.userId)).coins;
    await db().update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, early.userId));
    await rewardEarlierVerified(db(), new Date());
    await rewardEarlierVerified(db(), new Date());
    expect((await userOf(early.userId)).coins).toBe(early0 + EMAIL_REWARD_COINS);
  });

  it('signs out the other devices and keeps this one', async () => {
    const p = await newPlayer();
    const here = await createSession(db(), p.userId);
    await createSession(db(), p.userId);
    await createSession(db(), p.userId);
    expect(await signOutOthers(db(), p.userId, sessionDigest(here.token))).toBe(2);
    expect((await db().select().from(sessions).where(eq(sessions.userId, p.userId))).map((s) => s.id)).toEqual([sessionDigest(here.token)]);
  });

  it('deleting the profile: signed out at once, deleted after the grace period, signing in cancels it', async () => {
    const p = await newPlayer();
    const now = new Date();
    await expect(requestAccountDeletion(db(), p.userId, { password: 'wrong', confirm: p.username }, '')).rejects.toThrow();
    await expect(requestAccountDeletion(db(), p.userId, { password: 'correct horse battery', confirm: 'someone' }, '')).rejects.toThrow();
    await createSession(db(), p.userId);
    const at = await requestAccountDeletion(db(), p.userId, { password: 'correct horse battery', confirm: p.username.toUpperCase() }, '', now);
    expect(await db().select().from(sessions).where(eq(sessions.userId, p.userId))).toHaveLength(0);
    expect((await pendingDeletion(db(), p.userId))?.getTime()).toBe(at.getTime());
    // Signing in cancels it.
    expect(await cancelDeletion(db(), p.userId)).toBe(true);
    expect(await pendingDeletion(db(), p.userId)).toBeNull();
    // Asked again: nothing happens before the date, then the profile is emptied.
    await requestAccountDeletion(db(), p.userId, { password: 'correct horse battery', confirm: p.username }, '', now);
    await runDueDeletions(db(), new Date(now.getTime() + 86_400_000));
    expect((await userOf(p.userId)).bannedAt).toBeNull();
    await runDueDeletions(db(), new Date(at.getTime() + 60_000));
    const u = await userOf(p.userId);
    expect(u.username).toMatch(/^deleted-/);
    expect(u.email).toContain('@deleted.invalid');
    expect(u.bannedAt).not.toBeNull();
    expect(await pendingDeletion(db(), p.userId)).toBeNull();
    await expect(authenticate(db(), { login: p.username, password: 'correct horse battery' })).rejects.toThrow();

    const owner = await playerWithCompany();
    const [org] = await db().select().from(organizations).where(eq(organizations.ownerId, owner.userId));
    await eraseAccount(db(), owner.userId);
    expect(await db().select().from(organizations).where(eq(organizations.id, org!.id))).toHaveLength(0);
  });

  it('devices: listed, signed out one by one, new devices remembered', async () => {
    const p = await newPlayer();
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
    expect(deviceLabel(ua)).toBe('Chrome на Windows');
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBe('Safari на iOS');
    const here = await createSession(db(), p.userId, ua);
    await createSession(db(), p.userId, 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36');
    const list = await listSessions(db(), p.userId, sessionDigest(here.token));
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ current: true, device: 'Chrome на Windows' });
    await expect(signOutSession(db(), p.userId, list[0]!.key, sessionDigest(here.token))).rejects.toThrow();
    await signOutSession(db(), p.userId, list[1]!.key, sessionDigest(here.token));
    expect(await listSessions(db(), p.userId, sessionDigest(here.token))).toHaveLength(1);
    // Another player's key does nothing.
    const other = await newPlayer();
    await expect(signOutSession(db(), other.userId, list[0]!.key, null)).rejects.toThrow();

    await afterLogin(db(), p.userId, ua, '');
    await afterLogin(db(), p.userId, ua, '');
    const history = await loginHistory(db(), p.userId, new Date());
    expect(history.map((h) => h.device)).toEqual(['Chrome на Windows', 'Chrome на Windows']);
  });

  it('the data export and a new username once in 30 days', async () => {
    const p = await newPlayer();
    const data = await exportAccount(db(), p.userId);
    expect(data.profile.username).toBe(p.username);
    expect(JSON.stringify(data)).not.toContain('passwordHash');
    expect(data.vehicles.length).toBeGreaterThan(0);

    const now = new Date();
    const name = `n_${Date.now().toString(36)}`.slice(0, 20);
    await changeUsername(db(), p.userId, name, now);
    expect((await userOf(p.userId)).username).toBe(name);
    await expect(changeUsername(db(), p.userId, `${name}x`.slice(0, 20), new Date(now.getTime() + 86_400_000))).rejects.toThrow();
    const other = await newPlayer();
    await expect(changeUsername(db(), other.userId, name.toUpperCase(), now)).rejects.toThrow();
    await changeUsername(db(), p.userId, `${name}y`.slice(0, 20), new Date(now.getTime() + 31 * 86_400_000));
  });

  it('the dashboard: last trips with the same lane again, and the first own truck after a few deliveries', async () => {
    const p = await newPlayer();
    const company = await accountOf(p.userId);
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, company.id));
    const done = await makeContract('Sofia', 'Plovdiv');
    const d = await acceptContract(db(), p.userId, done.id, truck!.id);
    await db().update(deliveries).set({ status: 'completed', completedAt: new Date(), late: false, payoutCents: 1234_00 }).where(eq(deliveries.id, d.id));
    await db().update(vehicles).set({ status: 'idle' }).where(eq(vehicles.id, truck!.id));
    const again = await makeContract('Sofia', 'Plovdiv');
    const trips = await recentTrips(db(), company.id, p.userId, new Date());
    expect(trips).toHaveLength(1);
    expect(trips[0]!.againId).toBeTruthy();
    expect((await db().select().from(contracts).where(eq(contracts.id, trips[0]!.againId!)))[0]!.destCityId).toBe(again.destCityId);

    expect((await sameLaneAgain(db(), company.id, p.userId, d.id, new Date()))?.loadId).toBe(trips[0]!.againId);
    expect(await sameLaneAgain(db(), company.id, p.userId, '00000000-0000-0000-0000-000000000000', new Date())).toBeNull();
    expect(pushActionsFor(`/game/trips/${d.id}`)?.[0]?.url).toBe(`/game/again/${d.id}`);

    expect(await firstOwnTruck(db(), company.id, FIRST_OWN_TRUCK_AFTER - 1)).toBeNull();
    const own = await firstOwnTruck(db(), company.id, FIRST_OWN_TRUCK_AFTER);
    expect(own).toMatchObject({ rental: { plate: truck!.plate, onTrip: false } });
    expect(own!.depots.length).toBeGreaterThan(0);
    // With a truck of their own, no card.
    await db().update(vehicles).set({ ownership: 'owned' }).where(eq(vehicles.id, truck!.id));
    expect(await firstOwnTruck(db(), company.id, FIRST_OWN_TRUCK_AFTER)).toBeNull();
  });
});

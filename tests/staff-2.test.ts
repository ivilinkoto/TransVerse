import { and, eq, like, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { PERFECT_ROLE_STREAK } from '@/lib/game/competition';
import { compensateAll } from '@/server/admin';
import { FRAUD } from '@/server/admin-economy';
import { closeDb } from '@/server/db/client';
import { adminAudit, companies, discordOutbox, laneRecords, users } from '@/server/db/schema';
import { runCommand } from '@/server/discord/commands';
import { postStaffAlerts } from '@/server/discord/staff-alerts';
import { recordPerfectTrip } from '@/server/game/competition';
import { GameError } from '@/server/game/errors';
import { post } from '@/server/game/finance';
import { cityByName, db, newPlayer } from './helpers';

const BOT = { DISCORD_BOT_TOKEN: 'test-token', DISCORD_APPLICATION_ID: '1', DISCORD_GUILD_ID: '2' };
const saved = Object.fromEntries(Object.keys(BOT).map((k) => [k, process.env[k]]));
beforeAll(() => {
  Object.assign(process.env, BOT);
});
afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  await closeDb();
});

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const staff = async (role: string) => {
  const p = await newPlayer();
  await db().update(users).set({ role }).where(eq(users.id, p.userId));
  return { id: p.userId, role, username: p.username };
};

describe('compensation for everyone', () => {
  it('administrators only; every active player gets it once, audited', async () => {
    const support = await staff('support');
    const admin = await staff('admin');
    const a = await newPlayer();
    const banned = await newPlayer();
    await db().update(users).set({ bannedAt: new Date() }).where(eq(users.id, banned.userId));
    expect(await code(compensateAll(db(), support, { kind: 'coins', amount: 5, reason: 'прекъсване на сървъра' }))).toBe('forbidden');
    expect(await code(compensateAll(db(), admin, { kind: 'coins', amount: 5, reason: 'x' }))).toBe('reason_required');
    const coins = async (id: string) => (await db().select().from(users).where(eq(users.id, id)))[0]!.coins;
    const before = await coins(a.userId);
    const r = await compensateAll(db(), admin, { kind: 'coins', amount: 5, reason: 'прекъсване на сървъра' });
    expect(r.players).toBeGreaterThan(1);
    expect(await coins(a.userId)).toBe(before + 5);
    expect(await coins(banned.userId)).toBe(0);
    const [entry] = await db().select().from(adminAudit).where(eq(adminAudit.id, r.auditId));
    expect(entry!.action).toBe('compensate_all');
    expect((entry!.details as { players: number }).players).toBe(r.players);

    const balance = async () => (await db().select().from(companies).where(eq(companies.ownerId, a.userId)))[0]!.balanceCents;
    const cash = await balance();
    await compensateAll(db(), admin, { kind: 'money', amount: 12.5, reason: 'грешка в заплащането' });
    expect(await balance()).toBe(cash + 1250);
  });
});

describe('Discord in v1.5', () => {
  it('staff alerts: fast money goes to #сигнали once a day', async () => {
    const p = await newPlayer();
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    await db().transaction((tx) => post(tx, acc!.id, [{ category: 'admin_adjustment', amountCents: FRAUD.fastMoneyCents + 1, description: 'test', idempotencyKey: `test-fast:${acc!.id}` }]));
    await postStaffAlerts(db());
    await postStaffAlerts(db());
    const rows = await db().select().from(discordOutbox).where(like(discordOutbox.dedupeKey, `staff-alert:fast:${p.username}:%`));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.target).toBe('channel:staffAlerts');
  });

  it('a perfect streak of 10 and its end update the Discord roles', async () => {
    const p = await newPlayer();
    const linked = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    await db().update(users).set({ perfectStreak: PERFECT_ROLE_STREAK - 1, discordId: linked }).where(eq(users.id, p.userId));
    const jobs = async () => (await db().select().from(discordOutbox).where(and(eq(discordOutbox.target, 'job:roles'), sql`${discordOutbox.payload}->>'userId' = ${p.userId}`))).length;
    const trip = { violations: [], events: [], tons: 20, payloadTons: 20, rewardCents: 1000_00 };
    const before = await jobs();
    await db().transaction((tx) => recordPerfectTrip(tx, p.userId, { ...trip, late: false }, new Date()));
    expect(await jobs()).toBe(before + 1);
    await db().transaction((tx) => recordPerfectTrip(tx, p.userId, { ...trip, late: true }, new Date(Date.now() + 1)));
    expect(await jobs()).toBe(before + 2);
  });

  it('/рекорди and /албум', async () => {
    const p = await newPlayer();
    const [a, b] = [await cityByName('Sofia'), await cityByName('Varna')];
    const now = new Date();
    const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit' }).format(now).slice(0, 7);
    await db().insert(laneRecords).values({ month, originCityId: a.id, destCityId: b.id, userId: p.userId, deliveryId: crypto.randomUUID(), minutes: 290, km: 440, setAt: now }).onConflictDoUpdate({ target: [laneRecords.month, laneRecords.originCityId, laneRecords.destCityId], set: { userId: p.userId, minutes: 290 } });
    const records = await runCommand(db(), { name: 'рекорди', options: { играч: p.username }, discordUserId: 'nobody' }, now);
    expect(records.embeds![0]!.description).toContain('4 ч 50 мин');
    const album = await runCommand(db(), { name: 'албум', options: { играч: p.username }, discordUserId: 'nobody' }, now);
    expect(album.embeds![0]!.title).toContain(`Албумът на ${p.username}: 0 /`);
    expect((await runCommand(db(), { name: 'албум', options: {}, discordUserId: 'nobody' }, now)).ephemeral).toBe(true);
  });
});

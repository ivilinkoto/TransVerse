import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));

const fake = vi.hoisted(() => {
  const state = { calls: [] as { method: string; path: string }[] };
  const call = async (method: string, path: string) => {
    state.calls.push({ method, path });
    if (method === 'POST' && path === '/users/@me/channels') return { id: 'dm1' };
    return { id: 'm1' };
  };
  return { state, call };
});
vi.mock('@/server/discord/api', async (load) => ({ ...(await load<typeof import('@/server/discord/api')>()), discord: fake.call }));

import { FEATURES } from '@/lib/game/features';
import { releaseByVersion } from '@/lib/game/releases';
import { withLocale } from '@/i18n/als';
import { tx } from '@/i18n/t';
import { searchUsers } from '@/server/admin';
import { closeDb } from '@/server/db/client';
import { companies, deliveries, discordOutbox, jobState, users, vehicles } from '@/server/db/schema';
import { releaseAnnouncement } from '@/server/discord/announce';
import { PLAYER_HELP, STAFF_HELP } from '@/server/discord/help';
import { failedOutbox, processOutbox, retryOutbox } from '@/server/discord/outbox';
import { remindCommand, sendArrivalReminders } from '@/server/discord/remind';
import { clearServerErrors, groupServerErrors, recentServerErrors, recordServerError } from '@/server/error-log';
import { acceptContract } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { buyDepot, buyVehicle, moveAllToDepot } from '@/server/game/fleet';
import { sameLaneAgain } from '@/server/game/overview';
import { setStaffNote, staffNote } from '@/server/staff-notes';
import { cityByName, db, makeContract, newPlayer, playerWithCompany } from './helpers';

beforeAll(() => {
  Object.assign(process.env, { DISCORD_BOT_TOKEN: 'test-token', DISCORD_APPLICATION_ID: 'app', DISCORD_GUILD_ID: 'g1', DISCORD_PUBLIC_KEY: 'x' });
});
afterAll(() => {
  for (const k of ['DISCORD_BOT_TOKEN', 'DISCORD_APPLICATION_ID', 'DISCORD_GUILD_ID', 'DISCORD_PUBLIC_KEY']) delete process.env[k];
  return closeDb();
});

let n = 0;
const discordId = () => `8${Date.now()}${++n}`;
const account = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;

describe('v1.1.3.5', () => {
  it('ships as its own release with its features', () => {
    expect(releaseByVersion('1.1.3.5')?.name).toBe('Поправки и удобства');
    for (const f of ['repeat_trip', 'depot_all', 'tab_badge', 'discord_remind', 'discord_quiet'] as const) expect(FEATURES[f]).toBe('1.1.3.5');
  });

  it('every free truck away from the depots goes to the nearest one', async () => {
    const p = await playerWithCompany('Sofia');
    const acc = await account(p.userId);
    await db().update(companies).set({ balanceCents: 2_000_000_00 }).where(eq(companies.id, acc.id));
    await db().execute(sql`update users set level = 5, xp = 999999 where id = ${p.userId}`);
    const plovdiv = await cityByName('Plovdiv');
    const varna = await cityByName('Varna');
    const homes = await db().execute<{ city_id: number }>(sql`select city_id from depots where company_id = ${acc.id}`);
    if (!homes.rows.some((h) => h.city_id === plovdiv.id)) await buyDepot(db(), p.userId, plovdiv.id);
    const a = await buyVehicle(db(), p.userId, 'danubia-t440', p.hq.id);
    const b = await buyVehicle(db(), p.userId, 'danubia-t440', p.hq.id);
    // Both stand in Burgas-side Varna, away from every depot; Plovdiv is nearer than Sofia.
    await db().update(vehicles).set({ cityId: varna.id, movingUntil: null }).where(sql`${vehicles.id} in (${a.id}, ${b.id})`);
    const before = (await account(p.userId)).balanceCents;
    const res = await moveAllToDepot(db(), p.userId);
    expect(res.moved).toBeGreaterThanOrEqual(2);
    const moved = await db().select({ cityId: vehicles.cityId, movingUntil: vehicles.movingUntil }).from(vehicles).where(sql`${vehicles.id} in (${a.id}, ${b.id})`);
    expect(moved.every((v) => v.cityId === plovdiv.id && v.movingUntil)).toBe(true);
    expect((await account(p.userId)).balanceCents).toBe(before);
    // On the road now: a second press moves nothing.
    expect((await moveAllToDepot(db(), p.userId)).moved).toBe(0);
  });

  it('"Същия курс отново" knows the lane and the truck', async () => {
    const p = await newPlayer('Sofia');
    const acc = await account(p.userId);
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc.id));
    const c = await makeContract('Sofia', 'Plovdiv');
    const d = await acceptContract(db(), p.userId, c.id, truck!.id);
    const again = await sameLaneAgain(db(), acc.id, p.userId, d.id, new Date());
    expect(again).toMatchObject({ originCityId: c.originCityId, destCityId: c.destCityId, vehicleId: truck!.id });
  });

  it('server errors: the same one on the same page is counted once; "Изчисти" empties the list', async () => {
    await clearServerErrors(db());
    await recordServerError('GET /game/trips/123?_rsc=a', Object.assign(new Error('boom'), { digest: 'd1' }), db());
    await recordServerError('GET /game/trips/456?_rsc=b', Object.assign(new Error('boom'), { digest: 'd2' }), db());
    await recordServerError('GET /game/fleet', new Error('other'), db());
    const groups = groupServerErrors(await recentServerErrors(db()));
    const trips = groups.find((g) => g.where === 'GET /game/trips/:n');
    expect(trips).toMatchObject({ count: 2, message: 'Error: boom' });
    expect(trips!.digests.sort()).toEqual(['d1', 'd2']);
    expect(groups).toHaveLength(2);
    await clearServerErrors(db());
    expect(await recentServerErrors(db())).toEqual([]);
  });

  it('a team note only from the team; Discord name and id find the player', async () => {
    const p = await newPlayer();
    const id = discordId();
    await db().update(users).set({ discordId: id, discordName: `kamion_${id}` }).where(eq(users.id, p.userId));
    expect((await searchUsers(db(), id)).map((u) => u.id)).toContain(p.userId);
    expect((await searchUsers(db(), `kamion_${id}`)).map((u) => u.id)).toContain(p.userId);
    const staff = await newPlayer();
    await db().update(users).set({ role: 'support' }).where(eq(users.id, staff.userId));
    const actor = { id: staff.userId, role: 'support', username: staff.username };
    await expect(setStaffNote(db(), { id: p.userId, role: 'player', username: p.username }, p.userId, 'x')).rejects.toBeInstanceOf(GameError);
    await setStaffNote(db(), actor, p.userId, 'предупреден за спам');
    expect(await staffNote(db(), p.userId)).toMatchObject({ note: 'предупреден за спам', by: staff.username });
    await setStaffNote(db(), actor, p.userId, '');
    expect(await staffNote(db(), p.userId)).toBeNull();
  });

  it('/напомни: a private message when the truck arrives, once', async () => {
    const p = await newPlayer('Sofia');
    const id = discordId();
    await db().update(users).set({ discordId: id }).where(eq(users.id, p.userId));
    expect((await remindCommand(db(), p.userId, id, null)).content).toContain('/курс');
    const acc = await account(p.userId);
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc.id));
    const d = await acceptContract(db(), p.userId, (await makeContract('Sofia', 'Plovdiv')).id, truck!.id);
    expect((await remindCommand(db(), p.userId, id, 'няма-такъв')).content).toContain('няма-такъв');
    const ok = await remindCommand(db(), p.userId, id, truck!.plate);
    expect(ok.embeds?.[0]?.description).toContain(truck!.plate);
    await sendArrivalReminders(db());
    expect(await db().select().from(discordOutbox).where(eq(discordOutbox.dedupeKey, `remind:${d.id}`))).toHaveLength(0);
    await db().update(deliveries).set({ status: 'completed', completedAt: new Date() }).where(eq(deliveries.id, d.id));
    await sendArrivalReminders(db());
    await sendArrivalReminders(db());
    const sent = await db().select().from(discordOutbox).where(eq(discordOutbox.dedupeKey, `remind:${d.id}`));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.target).toBe(`dm:${id}`);
    expect(await db().select().from(jobState).where(eq(jobState.key, `discord-remind:${d.id}`))).toHaveLength(0);
  });

  it('private messages wait for the quiet hours; a failed message can be sent again', async () => {
    const p = await newPlayer();
    const id = discordId();
    await db().update(users).set({ discordId: id, quietHours: { from: 10, to: 14 } }).where(eq(users.id, p.userId));
    const noon = new Date('2026-10-30T12:00:00+02:00');
    const [row] = await db().insert(discordOutbox).values({ dedupeKey: `quiet-test:${id}`, target: `dm:${id}`, payload: { content: 'hi' }, nextAttemptAt: new Date(noon.getTime() - 1000) }).returning();
    await processOutbox(db(), noon, 1000);
    let [after] = await db().select().from(discordOutbox).where(eq(discordOutbox.id, row!.id));
    expect(after!.sentAt).toBeNull();
    expect(after!.attempts).toBe(0);
    expect(after!.nextAttemptAt.getTime()).toBeGreaterThan(noon.getTime());
    // After the quiet hours it goes.
    const later = new Date('2026-10-30T15:00:00+02:00');
    await processOutbox(db(), later, 1000);
    [after] = await db().select().from(discordOutbox).where(eq(discordOutbox.id, row!.id));
    expect(after!.sentAt).not.toBeNull();
    // A given-up message shows in the admin list and goes again on "Прати пак".
    await db().update(discordOutbox).set({ lastError: 'Missing Access', attempts: 6 }).where(eq(discordOutbox.id, row!.id));
    expect((await failedOutbox(db(), 200)).find((r) => r.id === row!.id)).toMatchObject({ gaveUp: true });
    expect(await retryOutbox(db(), row!.id)).toBe(true);
    [after] = await db().select().from(discordOutbox).where(eq(discordOutbox.id, row!.id));
    expect(after).toMatchObject({ attempts: 0, sentAt: null, lastError: null });
  });

  it('/помощ in the reader\'s language; the release announcement links to its own notes', () => {
    for (const line of [...PLAYER_HELP, ...STAFF_HELP].filter((l) => /[а-я]/i.test(l) && !l.includes('http'))) {
      expect(withLocale('en', () => tx(line)), line).not.toBe(line);
    }
    const msg = releaseAnnouncement(releaseByVersion('1.1.3.5')!);
    expect(JSON.stringify(msg.components)).toContain('/updates#v1.1.3.5');
  });
});

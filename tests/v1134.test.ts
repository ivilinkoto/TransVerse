import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));

/** A small fake Discord server: its channels and every call the bot makes. */
const fake = vi.hoisted(() => {
  const state = { channels: [] as { id: string; name: string; type: number }[], calls: [] as { method: string; path: string; body?: unknown }[], next: 1000 };
  const call = async (method: string, path: string, body?: unknown) => {
    state.calls.push({ method, path, body });
    if (method === 'GET' && path === '/users/@me') return { id: 'bot', username: 'TransVerse' };
    if (method === 'GET' && /^\/guilds\/\w+\/channels$/.test(path)) return state.channels;
    if (method === 'GET' && /^\/guilds\/\w+\/roles$/.test(path)) return [];
    if (method === 'POST' && /^\/guilds\/\w+\/roles$/.test(path)) return { id: `r${state.next++}`, name: 'x', permissions: '0', position: 1 };
    if (method === 'POST' && /\/messages$/.test(path)) return { id: `m${state.next++}` };
    return {};
  };
  return { state, call };
});
vi.mock('@/server/discord/api', async (load) => ({ ...(await load<typeof import('@/server/discord/api')>()), discord: fake.call }));

import { FEATURES } from '@/lib/game/features';
import { comingReleases, releaseByVersion } from '@/lib/game/releases';
import { closeDb } from '@/server/db/client';
import { companies, deliveries, discordOutbox, ideas, jobState, supportTickets, users, vehicles } from '@/server/db/schema';
import { runCommand } from '@/server/discord/commands';
import type { Interaction } from '@/server/discord/context';
import { forgetGuild } from '@/server/discord/guild';
import { answerInteraction } from '@/server/discord/interaction';
import { COSMETIC_BONUS, levelReward } from '@/server/discord/levels';
import { bugReaction, ideasWeeklyTop, IDLE_AFTER_MS, idleTruckReminders, staffDailyNumbers } from '@/server/discord/plus';
import { nextUpdateName } from '@/server/discord/stats';
import { DRIVER_OF_WEEK_KEY } from '@/server/discord/sync';
import { announceWeeklyRanking } from '@/server/discord/weekly';
import { runAction } from '@/server/game/actions';
import { submitIdea, voteIdea } from '@/server/game/ideas';
import { createTicket } from '@/server/game/support';
import { db, makeContract, newPlayer } from './helpers';
import { acceptContract } from '@/server/game/deliveries';

beforeAll(() => {
  Object.assign(process.env, { DISCORD_BOT_TOKEN: 'test-token', DISCORD_APPLICATION_ID: 'app', DISCORD_GUILD_ID: 'g1', DISCORD_PUBLIC_KEY: 'x', DISCORD_CLIENT_SECRET: 'secret' });
});
afterAll(() => {
  for (const k of ['DISCORD_BOT_TOKEN', 'DISCORD_APPLICATION_ID', 'DISCORD_GUILD_ID', 'DISCORD_PUBLIC_KEY', 'DISCORD_CLIENT_SECRET']) delete process.env[k];
  return closeDb();
});
beforeEach(async () => {
  fake.state.calls.length = 0;
  fake.state.channels = ['💡┃идеи', '🐞┃докладвай-бъг', '🚨┃сигнали', '🏆┃класации'].map((name, i) => ({ id: `ch${i}`, name, type: 0 }));
  forgetGuild();
  await db().delete(jobState).where(eq(jobState.key, 'discord-layout'));
});

let n = 0;
const discordId = () => `7${Date.now()}${++n}`;
async function linked(level = 2) {
  const p = await newPlayer();
  const id = discordId();
  await db().update(users).set({ discordId: id, level }).where(eq(users.id, p.userId));
  return { ...p, discordId: id };
}
const outbox = async (prefix: string) => (await db().select().from(discordOutbox)).filter((r) => r.dedupeKey.startsWith(prefix));
const ix = (o: { data: Interaction['data']; user: string; type?: number }): Interaction => ({ id: `i${++n}`, token: 'tok', type: o.type ?? 2, channel_id: 'c', data: o.data, guild_id: 'g1', member: { user: { id: o.user, username: 'u' }, roles: [], permissions: '0' } } as Interaction);

describe('v1.1.3.4', () => {
  it('ships as its own release', () => {
    expect(FEATURES.discord_plus).toBe('1.1.3.4');
    expect(releaseByVersion('1.1.3.4')?.name).toBe('Discord+');
  });

  it('level rewards: every fifth level, and a truck part on every tenth', () => {
    expect([5, 7, 10, 15, 20].map((l) => levelReward(l, true))).toEqual([5, 0, 10 + COSMETIC_BONUS, 15, 20 + COSMETIC_BONUS]);
    expect([5, 10].map((l) => levelReward(l))).toEqual([0, 10]);
  });

  it('the countdown channel names the next update', () => {
    const now = new Date('2026-10-30T10:00:00+02:00');
    expect(comingReleases(now)[0]?.version).toBe('1.1.4');
    expect(nextUpdateName(now)).toContain('1.1.4');
    expect(nextUpdateName(now)).toBe('🆕 1.1.4 след 2 дни');
    expect(nextUpdateName(new Date('2026-10-31T09:00:00+02:00'))).toBe('🆕 1.1.4 след 3 ч');
  });

  it('/статистика gives the company card, /сравни two players side by side', async () => {
    const a = await linked();
    const b = await newPlayer();
    const none = await runCommand(db(), { name: 'статистика', options: {}, discordUserId: a.discordId });
    expect(none.ephemeral).toBe(true);
    const cmp = await runCommand(db(), { name: 'сравни', options: { играч: b.username }, discordUserId: a.discordId });
    expect(cmp.embeds?.[0]?.fields?.length).toBe(6);
    const self = await runCommand(db(), { name: 'сравни', options: { играч: a.username }, discordUserId: a.discordId });
    expect(self.ephemeral).toBe(true);
  });

  it('an idle truck gets one reminder for those who asked; not while playing', async () => {
    const p = await linked();
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
    const later = new Date(truck!.purchasedAt.getTime() + IDLE_AFTER_MS + 60_000);
    await db().update(users).set({ lastSeenAt: new Date(later.getTime() - 3_600_000) }).where(eq(users.id, p.userId));
    await idleTruckReminders(db(), later);
    expect(await outbox(`idle:${truck!.id}:`)).toHaveLength(0);
    await db().update(users).set({ discordPrefs: { idle: true } }).where(eq(users.id, p.userId));
    await idleTruckReminders(db(), later);
    await idleTruckReminders(db(), later);
    const [dm] = await outbox(`idle:${truck!.id}:`);
    expect(dm!.target).toBe(`dm:${p.discordId}`);
    expect(await outbox(`idle:${truck!.id}:`)).toHaveLength(1);
    // While in the game: nothing.
    await db().update(discordOutbox).set({ dedupeKey: `x${dm!.id}` }).where(eq(discordOutbox.id, dm!.id));
    await db().update(users).set({ lastSeenAt: later }).where(eq(users.id, p.userId));
    await idleTruckReminders(db(), later);
    expect(await outbox(`idle:${truck!.id}:`)).toHaveLength(0);
  });

  it('✅ from a linked member of the team under a bug report closes its ticket', async () => {
    const p = await linked();
    const ticket = await createTicket(db(), { id: p.userId, role: 'player', username: p.username }, { subject: 'Бъг в картата', category: 'bug', body: 'Картата не се показва.' });
    await db().insert(jobState).values({ key: 'bug-ticket:msg1', value: { ticketId: ticket.id, channelId: 'ch1' } }).onConflictDoUpdate({ target: jobState.key, set: { value: { ticketId: ticket.id, channelId: 'ch1' } } });
    // A player's ✅ does nothing.
    expect(await bugReaction(db(), { user_id: p.discordId, channel_id: 'ch1', message_id: 'msg1', emoji: { name: '✅' } })).toBe(false);
    const staff = await linked();
    await db().update(users).set({ role: 'support' }).where(eq(users.id, staff.userId));
    expect(await bugReaction(db(), { user_id: staff.discordId, channel_id: 'ch1', message_id: 'msg1', emoji: { name: '✅' } })).toBe(true);
    expect((await db().select().from(supportTickets).where(eq(supportTickets.id, ticket.id)))[0]!.status).toBe('closed');
    expect(await bugReaction(db(), { user_id: staff.discordId, channel_id: 'ch1', message_id: 'msg1', emoji: { name: '✅' } })).toBe(false);
  });

  it('votes from Discord are counted apart; the weekly top 3 goes to #идеи on Monday', async () => {
    const author = await linked();
    const idea = await submitIdea(db(), author.userId, { title: 'Повече ферибоди по Дунав', body: '' });
    const v1 = await linked();
    const v2 = await linked();
    await runAction(db(), { id: v1.userId, role: 'player', username: v1.username }, { type: 'voteIdea', ideaId: idea.id }, async () => `discord:${v1.discordId}`);
    await voteIdea(db(), v2.userId, idea.id);
    let [row] = await db().select().from(ideas).where(eq(ideas.id, idea.id));
    expect(row).toMatchObject({ votes: 2, discordVotes: 1 });
    // Taking the Discord vote back.
    await runAction(db(), { id: v1.userId, role: 'player', username: v1.username }, { type: 'voteIdea', ideaId: idea.id }, async () => `discord:${v1.discordId}`);
    [row] = await db().select().from(ideas).where(eq(ideas.id, idea.id));
    expect(row).toMatchObject({ votes: 1, discordVotes: 0 });
    const monday = new Date('2026-11-02T11:00:00+02:00');
    expect(await ideasWeeklyTop(db(), monday)).toBe(true);
    expect((await outbox('ideas-top:2026-11-02')).length).toBeGreaterThan(0);
    expect(await ideasWeeklyTop(db(), new Date('2026-11-03T11:00:00+02:00'))).toBe(false);
  });

  it('the driver of the week gets the role for seven days (Sunday evening)', async () => {
    const p = await linked();
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
    const sunday = new Date('2026-11-01T20:30:00+02:00');
    for (let i = 0; i < 3; i++) {
      await db().update(vehicles).set({ status: 'idle', movingUntil: null }).where(eq(vehicles.id, truck!.id));
      const c = await makeContract('Sofia', 'Plovdiv');
      const d = await acceptContract(db(), p.userId, c.id, truck!.id);
      await db().update(deliveries).set({ status: 'completed', completedAt: new Date(sunday.getTime() - (i + 1) * 3_600_000) }).where(eq(deliveries.id, d.id));
    }
    await db().update(vehicles).set({ status: 'idle' }).where(eq(vehicles.id, truck!.id));
    await announceWeeklyRanking(db(), sunday);
    const [row] = await db().select().from(jobState).where(eq(jobState.key, DRIVER_OF_WEEK_KEY));
    // Other test files may drive more this week: someone is crowned, for seven days.
    expect(row!.value).toMatchObject({ until: sunday.getTime() + 7 * 86_400_000 });
  });

  it('the team’s daily numbers and "Преведи" without a key', async () => {
    const numbers = await staffDailyNumbers(db(), new Date());
    expect(numbers.newPlayers).toBeGreaterThan(0);
    expect(Array.isArray(numbers.failingJobs)).toBe(true);
    const p = await linked();
    const a = await answerInteraction(db(), ix({ data: { name: 'Преведи', target_id: 'm1', resolved: { messages: { m1: { id: 'm1', content: 'Hello drivers' } } } }, user: p.discordId }));
    expect(JSON.stringify(a.response)).toContain('не е включен');
  });
});


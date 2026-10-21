import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));

/** A small fake Discord server: channels, roles and every call the bot makes. */
const fake = vi.hoisted(() => {
  const state = {
    channels: [] as { id: string; name: string; type: number; parent_id?: string | null; position: number; topic?: string | null; permission_overwrites?: unknown[] }[],
    roles: [] as { id: string; name: string; permissions: string; position: number }[],
    calls: [] as { method: string; path: string; body?: unknown }[],
    messages: [] as unknown[],
    members: [] as unknown[],
    next: 1000,
  };
  const call = async (method: string, path: string, body?: unknown) => {
    state.calls.push({ method, path, body });
    const b = (body ?? {}) as Record<string, unknown>;
    if (method === 'GET' && path === '/users/@me') return { id: 'bot', username: 'TransVerse' };
    if (method === 'GET' && /^\/guilds\/\w+\/channels$/.test(path)) return state.channels;
    if (method === 'GET' && /^\/guilds\/\w+\/roles$/.test(path)) return state.roles;
    if (method === 'POST' && /^\/guilds\/\w+\/roles$/.test(path)) {
      const r = { id: `r${state.next++}`, name: String(b.name), permissions: '0', position: 1 };
      state.roles.push(r);
      return r;
    }
    if (method === 'POST' && /^\/guilds\/\w+\/channels$/.test(path)) {
      const c = { id: `c${state.next++}`, name: String(b.name), type: Number(b.type ?? 0), parent_id: (b.parent_id as string) ?? null, position: 0, topic: (b.topic as string) ?? null };
      state.channels.push(c);
      return c;
    }
    if (method === 'PATCH' && /^\/channels\/[\w-]+$/.test(path)) {
      const c = state.channels.find((x) => x.id === path.split('/')[2]);
      if (c && b.name) c.name = String(b.name);
      if (c && 'parent_id' in b) c.parent_id = b.parent_id as string;
      return c;
    }
    if (method === 'POST' && path === '/users/@me/channels') return { id: 'dm' };
    if (method === 'GET' && /^\/channels\/[\w-]+\/messages\?/.test(path)) return state.messages;
    if (method === 'GET' && /^\/guilds\/\w+\/members\?/.test(path)) return state.members;
    if (method === 'POST' && /\/messages$/.test(path)) return { id: `m${state.next++}` };
    return {};
  };
  return { state, call };
});
vi.mock('@/server/discord/api', async (load) => ({ ...(await load<typeof import('@/server/discord/api')>()), discord: fake.call }));

import { closeDb } from '@/server/db/client';
import { coinEntries, companies, discordQuizzes, discordSanctions, discordVoice, discordMembers, discordOutbox, jobState, organizations, treasuryEntries, users } from '@/server/db/schema';
import { automod, resetAutomod } from '@/server/discord/automod';
import { awardMostActive, countCompanyMessage } from '@/server/discord/company-life';
import { type Interaction } from '@/server/discord/context';
import { forgetGuild } from '@/server/discord/guild';
import { answerInteraction } from '@/server/discord/interaction';
import { layoutState, saveLayoutState } from '@/server/discord/layout';
import { levelOf, messageXp, voiceXp, xpToNext } from '@/server/discord/levels';
import { photoContest } from '@/server/discord/photos';
import { makeQuestion, runQuiz } from '@/server/discord/quiz';
import { voiceChanged } from '@/server/discord/rooms';
import { convoyCandidates } from '@/server/game/convoy';
import { db, newPlayer, playerWithCompany } from './helpers';

beforeAll(() => {
  Object.assign(process.env, { DISCORD_BOT_TOKEN: 'test-token', DISCORD_APPLICATION_ID: 'app', DISCORD_GUILD_ID: 'g1', DISCORD_PUBLIC_KEY: 'x', DISCORD_CLIENT_SECRET: 'secret' });
});
afterAll(() => {
  for (const k of ['DISCORD_BOT_TOKEN', 'DISCORD_APPLICATION_ID', 'DISCORD_GUILD_ID', 'DISCORD_PUBLIC_KEY', 'DISCORD_CLIENT_SECRET']) delete process.env[k];
  return closeDb();
});
beforeEach(async () => {
  fake.state.calls.length = 0;
  fake.state.channels = [];
  fake.state.roles = [];
  forgetGuild();
  await db().delete(jobState).where(eq(jobState.key, 'discord-layout'));
});

let n = 0;
const discordId = () => `8${Date.now()}${++n}`;
const ix = (o: { type: number; data?: Interaction['data']; user: string; perms?: string; channel?: string; dm?: boolean }): Interaction => ({
  id: 'i1', token: 'tok', type: o.type, channel_id: o.channel ?? 'c-chat', data: o.data,
  ...(o.dm ? { user: { id: o.user, username: `u${o.user}` } } : { guild_id: 'g1', member: { user: { id: o.user, username: `u${o.user}` }, roles: [], permissions: o.perms ?? '0' } }),
});
const text = (a: { response: unknown }) => JSON.stringify(a.response);
const outbox = async (prefix: string) => (await db().select().from(discordOutbox)).filter((r) => r.dedupeKey.startsWith(prefix));
async function linkedPlayer() {
  const p = await newPlayer();
  const id = discordId();
  await db().update(users).set({ discordId: id }).where(eq(users.id, p.userId));
  return { ...p, discordId: id };
}
const MOD = String(1n << 40n);
const BAN = String(1n << 2n);
const ADMIN = String(1n << 3n);

describe('levels', () => {
  it('experience for messages once a minute; every tenth level pays ТрансКоин once', async () => {
    expect(levelOf(0).level).toBe(0);
    expect(levelOf(xpToNext(0)).level).toBe(1);
    const p = await linkedPlayer();
    const t0 = new Date('2026-11-01T10:00:00Z');
    expect(await messageXp(db(), { channel_id: 'c', author: { id: p.discordId, username: 'x' } }, t0)).toBe(true);
    expect(await messageXp(db(), { channel_id: 'c', author: { id: p.discordId, username: 'x' } }, new Date(t0.getTime() + 10_000))).toBe(false);
    // Just below level 10: the next message levels up and pays once.
    let below = 0;
    for (let l = 0; l < 10; l++) below += xpToNext(l);
    await db().update(discordMembers).set({ xp: below - 1, level: 9 }).where(eq(discordMembers.discordUserId, p.discordId));
    await messageXp(db(), { channel_id: 'c', author: { id: p.discordId, username: 'x' } }, new Date(t0.getTime() + 120_000));
    const [m] = await db().select().from(discordMembers).where(eq(discordMembers.discordUserId, p.discordId));
    expect(m!.level).toBe(10);
    const paid = (await db().select().from(coinEntries).where(eq(coinEntries.userId, p.userId))).filter((e) => e.reason === 'discord_level');
    expect(paid).toHaveLength(1);
    expect(await outbox(`level-up:${p.discordId}:10`)).toHaveLength(1);
    // /ранг and /топ answer.
    expect(text(await answerInteraction(db(), ix({ type: 2, user: p.discordId, data: { name: 'ранг' } })))).toContain('Ниво 10');
    expect(text(await answerInteraction(db(), ix({ type: 2, user: p.discordId, data: { name: 'топ' } })))).toContain(p.discordId);
  });

  it('voice: experience with company, rooms made and removed, a convoy through the voice channel', async () => {
    await saveLayoutState(db(), { channels: { 'създай-стая': 'v-create', конвой: 'v-convoy', afk: 'v-afk' }, categories: {}, panels: {} });
    await db().delete(discordVoice);
    const a = await linkedPlayer();
    const b = await linkedPlayer();
    await voiceChanged(db(), { user_id: a.discordId, channel_id: 'v-talk' });
    await voiceChanged(db(), { user_id: b.discordId, channel_id: 'v-talk' });
    expect(await voiceXp(db())).toBe(2);
    // "Създай стая": a room, the member moved there; empty again: removed.
    await voiceChanged(db(), { user_id: a.discordId, channel_id: 'v-create', member: { user: { username: 'A' } } });
    const room = fake.state.channels.find((c) => c.name.startsWith('🔊 Стаята на'))!;
    expect(fake.state.calls.some((c) => c.method === 'PATCH' && c.path.endsWith(`/members/${a.discordId}`) && (c.body as { channel_id: string }).channel_id === room.id)).toBe(true);
    await voiceChanged(db(), { user_id: a.discordId, channel_id: room.id });
    await voiceChanged(db(), { user_id: a.discordId, channel_id: null });
    expect(fake.state.calls.some((c) => c.method === 'DELETE' && c.path === `/channels/${room.id}`)).toBe(true);
    // Both in "Конвой": a's trips count as b's convoy partner (the lane check is done by the game).
    await voiceChanged(db(), { user_id: a.discordId, channel_id: 'v-convoy' });
    await voiceChanged(db(), { user_id: b.discordId, channel_id: 'v-convoy' });
    const { acceptContract } = await import('@/server/game/deliveries');
    const { makeContract } = await import('./helpers');
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, a.userId));
    const { vehicles } = await import('@/server/db/schema');
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
    const c = await makeContract('Sofia', 'Plovdiv');
    await acceptContract(db(), a.userId, c.id, truck!.id);
    const mates = await convoyCandidates(db(), b.userId, new Date(), { originCityId: c.originCityId, destCityId: c.destCityId });
    expect(mates.map((m) => m.userId)).toContain(a.userId);
  });
});

describe('protection', () => {
  it('automatic moderation: the message goes; second time a warning, third a timeout', async () => {
    resetAutomod();
    const id = discordId();
    const msg = (k: number, content: string) => ({ id: `am-${id}-${k}`, channel_id: 'c-chat', guild_id: 'g1', content, author: { id }, member: { roles: [] } });
    expect(await automod(db(), msg(1, 'здрасти'))).toBeNull();
    expect((await automod(db(), msg(2, 'ела https://discord.gg/abc')))!.step).toBe('изтрито');
    expect((await automod(db(), msg(3, '@everyone вижте')))!.step).toBe('предупреждение');
    expect((await automod(db(), msg(4, 'discord.com/invite/xyz')))!.step).toBe('заглушен за 30 минути');
    const rows = await db().select().from(discordSanctions).where(eq(discordSanctions.discordUserId, id));
    expect(rows.map((r) => r.kind).sort()).toEqual(['timeout', 'warn']);
    // Turned off in the admin panel: nothing happens.
    await saveLayoutState(db(), { channels: {}, categories: {}, panels: {}, settings: { automod: false } });
    expect(await automod(db(), msg(5, 'discord.gg/again'))).toBeNull();
  });

  it('appeal: the member writes, the team accepts, the ban is lifted', async () => {
    const target = discordId();
    await answerInteraction(db(), ix({ type: 2, user: discordId(), perms: BAN, data: { name: 'бан', options: [{ name: 'потребител', value: target }, { name: 'причина', value: 'спам' }] } }));
    const [s] = await db().select().from(discordSanctions).where(eq(discordSanctions.discordUserId, target));
    const form = await answerInteraction(db(), ix({ type: 3, user: target, dm: true, data: { custom_id: `appeal:open:${s!.id}` } }));
    expect(form.response.type).toBe(9);
    await answerInteraction(db(), ix({ type: 5, user: target, dm: true, data: { custom_id: `appeal:send:${s!.id}`, components: [{ components: [{ custom_id: 'text', value: 'Беше грешка, няма да се повтори повече.' }] }] } }));
    expect(await outbox(`appeal:${s!.id}`)).toHaveLength(1);
    // Someone without the right cannot decide.
    expect(text(await answerInteraction(db(), ix({ type: 3, user: discordId(), data: { custom_id: `appeal:yes:${s!.id}` } })))).toContain('Нямаш право');
    fake.state.calls.length = 0;
    await answerInteraction(db(), ix({ type: 3, user: discordId(), perms: BAN, data: { custom_id: `appeal:yes:${s!.id}` } }));
    expect(fake.state.calls.some((c) => c.method === 'DELETE' && c.path.endsWith(`/bans/${target}`))).toBe(true);
    const [after] = await db().select().from(discordSanctions).where(eq(discordSanctions.id, s!.id));
    expect(after!.appealStatus).toBe('accepted');
  });

  it('the new members check: a wrong sum fails, the right one gives the role', async () => {
    const id = discordId();
    const start = await answerInteraction(db(), ix({ type: 3, user: id, data: { custom_id: 'verify:start' } }));
    const sum = /verify:sum:(\d+)/.exec(text(start))![1]!;
    expect(text(await answerInteraction(db(), ix({ type: 5, user: id, data: { custom_id: `verify:sum:${sum}`, components: [{ components: [{ custom_id: 'sum', value: '999' }] }] } })))).toContain('Грешен');
    await answerInteraction(db(), ix({ type: 5, user: id, data: { custom_id: `verify:sum:${sum}`, components: [{ components: [{ custom_id: 'sum', value: sum }] }] } }));
    const role = fake.state.roles.find((r) => r.name === '✅ Проверен')!;
    expect(fake.state.calls.some((c) => c.method === 'PUT' && c.path.endsWith(`/members/${id}/roles/${role.id}`))).toBe(true);
  });
});

describe('help', () => {
  it('players see their commands; members with rights see the team part too', async () => {
    const player = text(await answerInteraction(db(), ix({ type: 2, user: discordId(), data: { name: 'помощ' } })));
    expect(player).toContain('Команди за играчите');
    expect(player).not.toContain('Команди за екипа');
    expect(text(await answerInteraction(db(), ix({ type: 2, user: discordId(), perms: MOD, data: { name: 'помощ' } })))).toContain('Команди за екипа');
  });
});

describe('community', () => {
  it('quiz: a real question; the first right answer of a linked player wins once', async () => {
    expect(await makeQuestion(db())).not.toBeNull();
    await saveLayoutState(db(), { channels: { викторина: 'c-quiz' }, categories: {}, panels: {} });
    fake.state.channels = [{ id: 'c-quiz', name: '🧠┃викторина', type: 0, position: 0 }];
    await db().delete(discordQuizzes);
    let id: string | null = null;
    for (let i = 0; i < 5 && !id; i++) id = await runQuiz(db(), new Date('2026-11-02T12:00:00Z'));
    const [q] = await db().select().from(discordQuizzes).where(eq(discordQuizzes.id, id!));
    const wrong = (q!.correct + 1) % q!.options.length;
    const a = await linkedPlayer();
    const b = await linkedPlayer();
    expect(text(await answerInteraction(db(), ix({ type: 3, user: a.discordId, data: { custom_id: `quiz:${q!.id}:${wrong}` } })))).toContain('Грешно');
    expect(text(await answerInteraction(db(), ix({ type: 3, user: a.discordId, data: { custom_id: `quiz:${q!.id}:${q!.correct}` } })))).toContain('Вече отговори');
    expect((await answerInteraction(db(), ix({ type: 3, user: b.discordId, data: { custom_id: `quiz:${q!.id}:${q!.correct}` } }))).response.type).toBe(7);
    expect((await db().select().from(coinEntries).where(eq(coinEntries.userId, b.userId))).filter((e) => e.reason === 'quiz')).toHaveLength(1);
  });

  it('photo of the week: the most ⭐ wins ТрансКоин once', async () => {
    const p = await linkedPlayer();
    await saveLayoutState(db(), { channels: { снимки: 'c-photo' }, categories: {}, panels: {} });
    fake.state.channels = [{ id: 'c-photo', name: '📸┃снимки', type: 0, position: 0 }];
    const monday = new Date('2026-11-09T10:00:00Z'); // 12:00 in Sofia
    const pic = (id: string, author: string, stars: number) => ({ id, timestamp: '2026-11-05T12:00:00Z', author: { id: author }, attachments: [{ url: `https://cdn/${id}.png`, content_type: 'image/png' }], reactions: [{ emoji: { name: '⭐' }, count: stars + 1, me: true }] });
    fake.state.messages = [pic('p1', 'someone', 2), pic('p2', p.discordId, 5)];
    expect(await photoContest(db(), monday)).toBe('p2');
    await photoContest(db(), monday);
    expect((await db().select().from(coinEntries).where(eq(coinEntries.userId, p.userId))).filter((e) => e.reason === 'photo_contest')).toHaveLength(1);
  });

  it('the most active company channel gets its prize once', async () => {
    const owner = await playerWithCompany();
    const [m] = await db().select({ orgId: organizations.id }).from(organizations).where(eq(organizations.name, `Тест ${owner.username}`));
    await db().update(organizations).set({ discordChannelId: `cc-${owner.username}` }).where(eq(organizations.id, m!.orgId));
    const lastWeek = new Date('2026-11-04T12:00:00Z');
    for (let i = 0; i < 25; i++) await countCompanyMessage(db(), `cc-${owner.username}`, lastWeek);
    const monday = new Date('2026-11-09T10:00:00Z');
    expect(await awardMostActive(db(), monday)).toBe(m!.orgId);
    await awardMostActive(db(), monday);
    expect((await db().select().from(treasuryEntries).where(eq(treasuryEntries.organizationId, m!.orgId))).filter((e) => e.category === 'discord_activity')).toHaveLength(1);
  });

  it('/ивент-старт needs an administrator of the game', async () => {
    const p = await linkedPlayer();
    const data = { name: 'ивент-старт', options: [{ name: 'шаблон', value: 'great_move' }, { name: 'часове', value: 24 }] };
    expect(text(await answerInteraction(db(), ix({ type: 2, user: p.discordId, perms: ADMIN, data })))).toContain('администраторите');
    await db().update(users).set({ role: 'admin' }).where(eq(users.id, p.userId));
    expect(text(await answerInteraction(db(), ix({ type: 2, user: p.discordId, perms: ADMIN, data })))).toContain('започна');
  });
});

void layoutState;

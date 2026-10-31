import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/** Features that are "not out yet" in a test (everything else is live). */
const gate = vi.hoisted(() => ({ off: new Set<string>() }));
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: (id: string) => !gate.off.has(id) }));

/** A small fake Discord server: its channels and every call the bot makes. */
const fake = vi.hoisted(() => {
  const state = { channels: [] as { id: string; name: string; type: number }[], calls: [] as { method: string; path: string; body?: unknown }[], next: 1000, threads: new Map<string, { parent: string; name: string }>(), failPatch: 0, messages: [] as { id: string; author: { id: string }; embeds: { title: string }[] }[] };
  const call = async (method: string, path: string, body?: unknown) => {
    state.calls.push({ method, path, body });
    if (method === 'GET' && path === '/users/@me') return { id: 'bot', username: 'TransVerse' };
    if (method === 'GET' && /^\/guilds\/\w+\/channels$/.test(path)) return state.channels;
    if (method === 'GET' && /^\/guilds\/\w+\/roles$/.test(path)) return [];
    if (method === 'POST' && /^\/guilds\/\w+\/roles$/.test(path)) return { id: `r${state.next++}`, name: 'x', permissions: '0', position: 1 };
    if (method === 'POST' && /\/messages$/.test(path)) return { id: `m${state.next++}` };
    if (method === 'POST' && /^\/channels\/[\w-]+\/threads$/.test(path)) return { id: `t${state.next++}` };
    if (method === 'GET' && /^\/channels\/[\w-]+\/messages\?limit=50$/.test(path)) return state.messages;
    if (method === 'GET' && /^\/channels\/[\w-]+$/.test(path)) {
      const th = state.threads.get(path.split('/')[2]!);
      return th ? { type: 11, parent_id: th.parent, name: th.name } : { type: 0 };
    }
    if (method === 'PATCH' && /\/messages\//.test(path) && state.failPatch) {
      const { DiscordError } = await import('@/server/discord/api');
      throw new DiscordError(state.failPatch, 'cannot edit');
    }
    return {};
  };
  return { state, call };
});
vi.mock('@/server/discord/api', async (load) => ({ ...(await load<typeof import('@/server/discord/api')>()), discord: fake.call }));

import { FEATURES } from '@/lib/game/features';
import { releaseByVersion } from '@/lib/game/releases';
import { closeDb } from '@/server/db/client';
import { discordOutbox, ideas, jobState, supportTickets, users } from '@/server/db/schema';
import { postBroadcastToDiscord, setBroadcast } from '@/server/broadcast';
import { bugFromDiscord, closeTeamPolls, ideaFromDiscord, STATUS_GAP_MS, updateStatus } from '@/server/discord/channels-1132';
import { COMING_SOON, syncComingSoon } from '@/server/discord/coming-soon';
import type { Interaction } from '@/server/discord/context';
import { forgetGuild } from '@/server/discord/guild';
import { answerInteraction } from '@/server/discord/interaction';
import { setIdeaStatus } from '@/server/game/ideas';
import { db, newPlayer } from './helpers';

const CHANNELS = ['💡┃идеи', '🐞┃докладвай-бъг', '🛠️┃статус', '📊┃анкети', '📣┃новини', '🎁┃раздавания', '⚔️┃битки', '⚔️┃en-battles', '🏁┃рали'];

beforeAll(() => {
  Object.assign(process.env, { DISCORD_BOT_TOKEN: 'test-token', DISCORD_APPLICATION_ID: 'app', DISCORD_GUILD_ID: 'g1', DISCORD_PUBLIC_KEY: 'x', DISCORD_CLIENT_SECRET: 'secret' });
});
afterAll(() => {
  for (const k of ['DISCORD_BOT_TOKEN', 'DISCORD_APPLICATION_ID', 'DISCORD_GUILD_ID', 'DISCORD_PUBLIC_KEY', 'DISCORD_CLIENT_SECRET']) delete process.env[k];
  return closeDb();
});
beforeEach(async () => {
  gate.off.clear();
  fake.state.calls.length = 0;
  fake.state.channels = CHANNELS.map((name, i) => ({ id: `ch${i}`, name, type: 0 }));
  fake.state.failPatch = 0;
  fake.state.messages = [];
  forgetGuild();
  await db().delete(jobState).where(eq(jobState.key, 'discord-layout'));
});

const chan = (name: string) => fake.state.channels.find((c) => c.name.endsWith(name))!.id;
const calls = (method: string, re: RegExp) => fake.state.calls.filter((c) => c.method === method && re.test(c.path));
const outbox = async (prefix: string) => (await db().select().from(discordOutbox)).filter((r) => r.dedupeKey.startsWith(prefix));
let n = 0;
const discordId = () => `9${Date.now()}${++n}`;
async function linkedPlayer(level = 2, locale = 'bg') {
  const p = await newPlayer();
  const id = discordId();
  await db().update(users).set({ discordId: id, level, locale }).where(eq(users.id, p.userId));
  return { ...p, discordId: id };
}
const msg = (channel: string, author: string, content: string) => ({ id: `msg${Date.now()}${++n}`, channel_id: chan(channel), content, author: { id: author } });
const ix = (o: { type: number; data: Interaction['data']; user: string; perms?: string }): Interaction => ({
  id: `i${++n}`, token: 'tok', type: o.type, channel_id: 'c-chat', data: o.data, guild_id: 'g1', member: { user: { id: o.user, username: `u${o.user}` }, roles: [], permissions: o.perms ?? '0' },
} as Interaction);
const MANAGE_GUILD = String(1n << 5n);

describe('v1.1.3.2', () => {
  it('ships the Discord bot for everyone as its own release', () => {
    for (const id of ['discord_bot', 'discord_events', 'weekly_digest', 'staff_alerts', 'discord_truck', 'discord_ideas', 'discord_bug_reports', 'discord_status', 'discord_news', 'discord_coming_soon'] as const) expect(FEATURES[id]).toBe('1.1.3.2');
    expect(releaseByVersion('1.1.3.2')?.name).toBe('Discord');
    // Game features keep their own release: their channels wait.
    expect(FEATURES.battles).not.toBe('1.1.3.2');
    expect(COMING_SOON.every((c) => FEATURES[c.feature] !== '1.1.3.2')).toBe(true);
  });

  it('pins one "Очаквайте" note in a waiting channel and removes it when the feature is out', async () => {
    await db().delete(jobState).where(like(jobState.key, 'coming-soon:%'));
    gate.off.add('battles');
    expect(await syncComingSoon(db())).toBe(2); // #битки and #en-battles (#ru-битвы is not in this server)
    const posts = calls('POST', /\/messages$/);
    expect(posts.map((c) => c.path).sort()).toEqual([`/channels/${chan('битки')}/messages`, `/channels/${chan('en-battles')}/messages`].sort());
    expect(JSON.stringify(posts[0]!.body)).toContain('🔜');
    expect(calls('PUT', /\/pins\//)).toHaveLength(2);
    // Once only.
    expect(await syncComingSoon(db())).toBe(0);
    // Released: the notes go.
    gate.off.clear();
    expect(await syncComingSoon(db())).toBe(2);
    expect(calls('DELETE', /\/messages\//)).toHaveLength(2);
    expect(await db().select().from(jobState).where(like(jobState.key, 'coming-soon:%'))).toHaveLength(0);
  });

  it('#идеи: a linked player’s message becomes an idea with a vote card; others vote with the button', async () => {
    const author = await linkedPlayer();
    const m = msg('идеи', author.discordId, 'Паркинг за камиони до всяко депо\nДа може да оставям ремаркета там.');
    expect(await ideaFromDiscord(db(), m)).toBe(true);
    const [idea] = await db().select().from(ideas).where(eq(ideas.userId, author.userId));
    expect(idea!.title).toBe('Паркинг за камиони до всяко депо');
    expect(idea!.body).toBe('Да може да оставям ремаркета там.');
    expect(await outbox(`idea:${idea!.id}`)).toHaveLength(1);
    expect(calls('DELETE', new RegExp(`/messages/${m.id}$`))).toHaveLength(1);

    const voter = await linkedPlayer();
    const a = await answerInteraction(db(), ix({ type: 3, data: { custom_id: `idea:vote:${idea!.id}` }, user: voter.discordId }));
    expect(JSON.stringify(a.response)).toContain('1');
    expect((await db().select().from(ideas).where(eq(ideas.id, idea!.id)))[0]!.votes).toBe(1);

    // The team's answer is posted too.
    await setIdeaStatus(db(), { id: author.userId, role: 'admin' }, idea!.id, 'planned', 'За 1.3');
    expect(await outbox(`idea-status:${idea!.id}:planned`)).toHaveLength(1);
  });

  it('#идеи: a too short title or an unlinked author get an answer and no idea', async () => {
    const p = await linkedPlayer();
    expect(await ideaFromDiscord(db(), msg('идеи', p.discordId, 'Хей'))).toBe(true);
    expect(await db().select().from(ideas).where(eq(ideas.userId, p.userId))).toHaveLength(0);
    expect(await ideaFromDiscord(db(), msg('идеи', discordId(), 'Нова идея за играта'))).toBe(true);
    expect(calls('POST', /\/messages$/).every((c) => (c.body as { message_reference?: unknown }).message_reference)).toBe(true);
    // Elsewhere it is just chat.
    gate.off.add('ideas');
    expect(await ideaFromDiscord(db(), msg('идеи', p.discordId, 'Още една идея за играта'))).toBe(false);
  });

  it('#докладвай-бъг: a ticket for a linked player, the team’s #сигнали otherwise', async () => {
    const p = await linkedPlayer();
    expect(await bugFromDiscord(db(), msg('докладвай-бъг', p.discordId, 'Камионът не тръгва\nНатискам „Приеми“ и нищо не става.'))).toBe(true);
    const [ticket] = await db().select().from(supportTickets).where(eq(supportTickets.userId, p.userId));
    expect(ticket).toMatchObject({ category: 'bug', subject: 'Камионът не тръгва' });
    const m = msg('докладвай-бъг', discordId(), 'Картата не се зарежда на телефона.');
    expect(await bugFromDiscord(db(), m)).toBe(true);
    const [row] = await outbox(`bug:${m.id}`);
    expect(row!.target).toBe('channel:staffAlerts');
    expect(await bugFromDiscord(db(), msg('докладвай-бъг', p.discordId, 'бъг'))).toBe(true);
  });

  it('#статус: one pinned card kept fresh; a long pause shows on the card, not as a new message', async () => {
    await db().delete(jobState).where(eq(jobState.key, 'discord-status'));
    const t0 = new Date();
    expect(await updateStatus(db(), t0)).toBe('posted');
    expect(calls('PUT', /\/pins\//)).toHaveLength(1);
    expect(await updateStatus(db(), new Date(t0.getTime() + 5 * 60_000))).toBe('updated');
    expect(calls('PATCH', /\/messages\//)).toHaveLength(1);
    const later = new Date(t0.getTime() + 5 * 60_000 + STATUS_GAP_MS + 60_000);
    expect(await updateStatus(db(), later)).toBe('updated');
    // 1.1.4.2: no separate "the game was down" message — the card says it.
    expect(await outbox('status-back:')).toHaveLength(0);
    expect(JSON.stringify(calls('PATCH', /\/messages\//).at(-1)!.body)).toContain('Последно прекъсване');
    expect(calls('POST', /\/messages$/)).toHaveLength(1);
  });

  it('/анкета and /новина for the team; votes change the numbers; the poll closes', async () => {
    const staff = discordId();
    const denied = await answerInteraction(db(), ix({ type: 2, data: { name: 'анкета', options: [{ name: 'въпрос', value: 'Кой ивент следващия път?' }, { name: 'отговори', value: 'Зимен; Рали' }] }, user: discordId() }));
    expect(JSON.stringify(denied.response)).toContain('Само екипът');
    await answerInteraction(db(), ix({ type: 2, data: { name: 'анкета', options: [{ name: 'въпрос', value: 'Кой ивент следващия път?' }, { name: 'отговори', value: 'Зимен; Рали; Пролетен' }, { name: 'часове', value: 2 }] }, user: staff, perms: MANAGE_GUILD }));
    expect(calls('POST', new RegExp(`/channels/${chan('анкети')}/messages$`))).toHaveLength(1);
    const [poll] = await db().select().from(jobState).where(like(jobState.key, 'team-poll:%'));
    const id = poll!.key.slice('team-poll:'.length);
    const vote = await answerInteraction(db(), ix({ type: 3, data: { custom_id: `tpoll:${id}:1` }, user: discordId() }));
    expect((vote.response as { type: number }).type).toBe(7);
    expect(JSON.stringify(vote.response)).toContain('100%');
    expect(await closeTeamPolls(db(), new Date(Date.now() + 3 * 3_600_000))).toBe(1);
    expect((await db().select().from(jobState).where(eq(jobState.key, poll!.key)))[0]!.value).toMatchObject({ closed: true });

    await answerInteraction(db(), ix({ type: 2, data: { name: 'новина', options: [{ name: 'заглавие', value: 'Нов сървър' }, { name: 'текст', value: 'Преместихме играта на по-бърз сървър.' }] }, user: staff, perms: MANAGE_GUILD }));
    expect((await outbox('news:')).some((r) => r.target === 'channel:teamNews')).toBe(true);
  });

  it('the team’s message to everyone goes to #новини, a warning also to #статус', async () => {
    const admin = await newPlayer();
    await setBroadcast(db(), { id: admin.userId, role: 'admin' }, { text: 'Профилактика в 23:00', tone: 'warning', hours: 2, discord: true }, new Date());
    expect(await postBroadcastToDiscord(db(), new Date())).toBe(true);
    const rows = (await outbox('broadcast:')).filter((r) => r.createdAt.getTime() > Date.now() - 60_000);
    expect(rows.map((r) => r.target).sort()).toEqual(['channel:status', 'channel:teamNews']);
  });

  it('a forum #докладвай-бъг: a new post becomes a ticket with the post’s title; replies in it do not', async () => {
    const forum = fake.state.channels.find((c) => c.name.endsWith('докладвай-бъг'))!;
    forum.type = 15;
    forgetGuild();
    const p = await linkedPlayer();
    const thread = `th${Date.now()}`;
    fake.state.threads.set(thread, { parent: forum.id, name: 'Не мога да купя камион' });
    const starter = { id: thread, channel_id: thread, content: 'Натискам „Купи“ и излиза грешка.', author: { id: p.discordId } };
    expect(await bugFromDiscord(db(), starter)).toBe(true);
    const [ticket] = await db().select().from(supportTickets).where(eq(supportTickets.userId, p.userId));
    expect(ticket).toMatchObject({ subject: 'Не мога да купя камион', category: 'bug' });
    expect(await bugFromDiscord(db(), { id: `${thread}x`, channel_id: thread, content: 'Още нещо по темата.', author: { id: p.discordId } })).toBe(false);
  });

  it('announcements and notes in a forum channel open a post of their own', async () => {
    const battles = fake.state.channels.find((c) => c.name.endsWith('⚔️┃битки'))!;
    battles.type = 15;
    forgetGuild();
    await db().delete(jobState).where(like(jobState.key, 'coming-soon:%'));
    gate.off.add('battles');
    await syncComingSoon(db());
    expect(calls('POST', new RegExp(`/channels/${battles.id}/threads$`))).toHaveLength(1);
    const [row] = await db().select().from(jobState).where(eq(jobState.key, 'coming-soon:битки'));
    expect(row!.value).toMatchObject({ forum: true });
    gate.off.clear();
    await syncComingSoon(db());
    // The whole post goes.
    expect(calls('DELETE', new RegExp(`^/channels/${(row!.value as { channelId: string }).channelId}$`))).toHaveLength(1);
  });

  it('#статус: a card that cannot be edited is never reposted every tick; only a deleted one is replaced', async () => {
    await db().delete(jobState).where(eq(jobState.key, 'discord-status'));
    const t0 = new Date();
    expect(await updateStatus(db(), t0)).toBe('posted');
    // 1.1.4.2: no access or Discord down — the same card stays, no copy is posted (this was the spam).
    for (const [i, code] of [403, 400, 503].entries()) {
      fake.state.failPatch = code;
      await expect(updateStatus(db(), new Date(t0.getTime() + (i + 1) * 5 * 60_000))).rejects.toThrow();
    }
    expect(calls('POST', /\/messages$/)).toHaveLength(1);
    // Deleted by hand: a new card.
    fake.state.failPatch = 404;
    expect(await updateStatus(db(), new Date(t0.getTime() + 20 * 60_000))).toBe('posted');
  });

  it('#статус: a lost id finds the bot’s card in the channel and edits it; duplicates go', async () => {
    await db().delete(jobState).where(eq(jobState.key, 'discord-status'));
    fake.state.messages = [
      { id: 'old2', author: { id: 'bot' }, embeds: [{ title: '🟢 TransVerse работи' }] },
      { id: 'old1', author: { id: 'bot' }, embeds: [{ title: '🟢 TransVerse работи' }] },
      { id: 'chat', author: { id: 'someone' }, embeds: [{ title: '🟢 TransVerse работи' }] },
    ];
    expect(await updateStatus(db(), new Date())).toBe('updated');
    expect(calls('POST', /\/messages$/)).toHaveLength(0);
    expect(calls('PATCH', /\/messages\/old2$/)).toHaveLength(1);
    expect(calls('DELETE', /\/messages\/old1$/)).toHaveLength(1);
    expect(calls('DELETE', /\/messages\/chat$/)).toHaveLength(0);
  });

  it('command options are read by their real name for players who play in English', async () => {
    const p = await linkedPlayer(2, 'en');
    const a = await answerInteraction(db(), ix({ type: 2, data: { name: 'раздаване', options: [{ name: 'награда', value: 10 }, { name: 'часове', value: 2 }, { name: 'заглавие', value: 'Test' }] }, user: p.discordId, perms: MANAGE_GUILD }));
    // Deferred (the giveaway is being posted), not "the prize must be between 1 and 100 000".
    expect((a.response as { type: number }).type).toBe(5);
    await a.later?.();
    expect(calls('POST', new RegExp(`/channels/${chan('раздавания')}/messages$`))).toHaveLength(1);
  });
});


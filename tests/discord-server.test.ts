import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));

/** A small fake Discord server: channels, roles and every call the bot makes. */
const fake = vi.hoisted(() => {
  const state = {
    channels: [] as { id: string; name: string; type: number; parent_id?: string | null; position: number; topic?: string | null; permission_overwrites?: unknown[] }[],
    roles: [] as { id: string; name: string; permissions: string; position: number }[],
    calls: [] as { method: string; path: string; body?: unknown }[],
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
    if (method === 'POST' && /\/messages$/.test(path)) return { id: `m${state.next++}` };
    return {};
  };
  return { state, call };
});
vi.mock('@/server/discord/api', async (load) => ({ ...(await load<typeof import('@/server/discord/api')>()), discord: fake.call }));

import { closeDb } from '@/server/db/client';
import { coinEntries, companies, companyPolls, companyPollVotes, discordGiveaways, discordOutbox, discordSanctions, discordTickets, jobState, organizations, supportMessages, supportTickets, users, vehicles } from '@/server/db/schema';
import { courseGo, truckLoads } from '@/server/discord/play';
import { syncCompanyPolls } from '@/server/discord/company-polls';
import { makeCtx, type Answer, type Interaction } from '@/server/discord/context';
import { drawGiveaways } from '@/server/discord/giveaways';
import { forgetGuild } from '@/server/discord/guild';
import { answerInteraction } from '@/server/discord/interaction';
import { applyLayout, layoutState, planLayout } from '@/server/discord/layout';
import { messageDeleted, rememberMessage } from '@/server/discord/logs';
import { postPanels } from '@/server/discord/panels';
import { updateStats } from '@/server/discord/stats';
import { syncTickets, ticketMessageFromDiscord } from '@/server/discord/tickets';
import { createPoll } from '@/server/game/polls';
import { replyToTicket } from '@/server/game/support';
import { db, makeContract, newPlayer, playerWithCompany } from './helpers';

beforeAll(() => {
  Object.assign(process.env, { DISCORD_BOT_TOKEN: 'test-token', DISCORD_APPLICATION_ID: 'app', DISCORD_GUILD_ID: 'g1', DISCORD_PUBLIC_KEY: 'x', DISCORD_CLIENT_SECRET: 'secret' });
});
afterAll(() => {
  for (const k of ['DISCORD_BOT_TOKEN', 'DISCORD_APPLICATION_ID', 'DISCORD_GUILD_ID', 'DISCORD_PUBLIC_KEY', 'DISCORD_CLIENT_SECRET']) delete process.env[k];
  return closeDb();
});
beforeEach(async () => {
  fake.state.calls.length = 0;
  forgetGuild();
  await db().delete(jobState).where(eq(jobState.key, 'discord-layout'));
});

let n = 0;
const discordId = () => `7${Date.now()}${++n}`;
const ADMIN = String(1n << 3n);
const ix = (o: { type: number; data?: Interaction['data']; user: string; perms?: string; channel?: string; roles?: string[] }): Interaction => ({
  id: 'i1', token: 'tok', type: o.type, guild_id: 'g1', channel_id: o.channel ?? 'c-chat', data: o.data, member: { user: { id: o.user, username: `u${o.user}` }, roles: o.roles ?? [], permissions: o.perms ?? '0' },
});
const outbox = async (prefix: string) => (await db().select().from(discordOutbox)).filter((r) => r.dedupeKey.startsWith(prefix));
const content = (a: Answer) => JSON.stringify(a.response);
async function linkedPlayer() {
  const p = await newPlayer();
  const id = discordId();
  await db().update(users).set({ discordId: id }).where(eq(users.id, p.userId));
  return { ...p, discordId: id };
}

describe('server layout', () => {
  it('plans, then makes and orders the categories and channels; nothing is deleted', async () => {
    fake.state.channels = [
      { id: 'cat-info', name: '📢 | Информация', type: 4, position: 0 },
      { id: 'ch-upd', name: '💻ǀǀобновления', type: 0, parent_id: 'cat-info', position: 0 },
      { id: 'ch-voice', name: '🔊ǀǀГоворилня #1', type: 2, position: 1 },
      { id: 'ch-old', name: 'стар-канал', type: 0, position: 2 },
    ];
    fake.state.roles = [{ id: 'g1', name: '@everyone', permissions: '0', position: 0 }];
    const plan = await planLayout(db());
    expect(plan.steps.find((s) => s.name === '🆕┃обновления')).toMatchObject({ action: 'rename', from: '💻ǀǀобновления' });
    expect(plan.steps.find((s) => s.name === '🚚 ┃ ДОБРЕ ДОШЛИ')).toMatchObject({ action: 'rename', from: '📢 | Информация' });
    expect(plan.steps.find((s) => s.name === '🔊 Говорилня #1')).toMatchObject({ action: 'rename' });
    expect(plan.others).toContain('#стар-канал');

    const { created } = await applyLayout(db(), { permissions: false });
    expect(created).toContain('логове');
    expect(fake.state.calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(fake.state.channels.find((c) => c.id === 'ch-upd')!.name).toBe('🆕┃обновления');
    const state = await layoutState(db());
    expect(state.channels['обновления']).toBe('ch-upd');
    expect(state.channels['stat-online']).toBeTruthy();
    // Done: the second plan has nothing to change.
    forgetGuild();
    const again = await planLayout(db());
    expect(again.steps.filter((s) => s.action !== 'keep')).toHaveLength(0);

    // The bot's messages: posted once, edited afterwards.
    expect(await postPanels(db(), created)).toEqual(expect.arrayContaining(['welcome', 'rules', 'link', 'roles', 'tickets']));
    fake.state.calls.length = 0;
    await postPanels(db(), []);
    expect(fake.state.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/messages'))).toHaveLength(0);

    // Statistics channels show numbers from the game.
    forgetGuild();
    expect(await updateStats(db())).toBe(4);
    expect(fake.state.channels.find((c) => c.id === state.channels['stat-players'])!.name).toMatch(/^👥 Шофьори: \d/);
  });
});

describe('tickets', () => {
  it('a linked player opens a ticket from Discord: a game ticket and a private channel, replies both ways', async () => {
    fake.state.channels = [];
    const p = await linkedPlayer();
    const start = await answerInteraction(db(), ix({ type: 3, user: p.discordId, data: { custom_id: 'ticket:open' } }));
    expect(content(start)).toContain('ticket:cat');
    const form = await answerInteraction(db(), ix({ type: 3, user: p.discordId, data: { custom_id: 'ticket:cat', values: ['bug'] } }));
    expect(form.response.type).toBe(9);
    const sent = await answerInteraction(db(), ix({ type: 5, user: p.discordId, data: { custom_id: 'ticket:new:bug', components: [{ components: [{ custom_id: 'subject', value: 'Камионът не тръгва' }] }, { components: [{ custom_id: 'body', value: 'Натискам Поеми и нищо не става.' }] }] } }));
    expect(sent.response.type).toBe(5);
    await sent.later!();
    const [t] = await db().select().from(discordTickets).where(eq(discordTickets.discordUserId, p.discordId));
    expect(t!.ticketId).toBeTruthy();
    const [game] = await db().select().from(supportTickets).where(eq(supportTickets.id, t!.ticketId!));
    expect(game).toMatchObject({ userId: p.userId, subject: 'Камионът не тръгва', category: 'bug' });

    // Discord → game.
    expect(await ticketMessageFromDiscord(db(), { id: `dm-${p.discordId}`, channel_id: t!.channelId, content: 'Ето снимка', author: { id: p.discordId } })).toBe(true);
    // Game → Discord (a staff reply written in the admin panel).
    await syncTickets(db());
    const [staff] = await db().select().from(users).where(eq(users.id, (await newPlayer()).userId));
    await db().update(users).set({ role: 'support' }).where(eq(users.id, staff!.id));
    await replyToTicket(db(), { id: staff!.id, role: 'support', username: staff!.username }, t!.ticketId!, 'Оправихме го.');
    await syncTickets(db());
    const msgs = await db().select().from(supportMessages).where(eq(supportMessages.ticketId, t!.ticketId!));
    expect(msgs.map((m) => m.body)).toEqual(['Натискам Поеми и нищо не става.', 'Ето снимка', 'Оправихме го.']);
    const out = (await db().select().from(discordOutbox)).filter((r) => r.target === `msg:${t!.channelId}`);
    expect(out).toHaveLength(1);
    expect(JSON.stringify(out[0]!.payload)).toContain('Оправихме го.');

    // Closed by the player: the game ticket closes too.
    const closed = await answerInteraction(db(), ix({ type: 3, user: p.discordId, channel: t!.channelId, data: { custom_id: 'ticket:close' } }));
    expect(content(closed)).toContain('Затворен');
    const [after] = await db().select().from(supportTickets).where(eq(supportTickets.id, t!.ticketId!));
    expect(after!.status).toBe('closed');
  });

  it('without a linked account the ticket lives only in Discord', async () => {
    const id = discordId();
    const sent = await answerInteraction(db(), ix({ type: 5, user: id, data: { custom_id: 'ticket:new:account', components: [{ components: [{ custom_id: 'subject', value: 'Не мога да вляза' }] }, { components: [{ custom_id: 'body', value: 'Забравих имейла си, помогнете.' }] }] } }));
    await sent.later!();
    const [t] = await db().select().from(discordTickets).where(eq(discordTickets.discordUserId, id));
    expect(t).toMatchObject({ subject: 'Не мога да вляза', ticketId: null });
  });
});

describe('moderation', () => {
  it('needs the Discord right; a warning is kept, logged and sent to the member', async () => {
    const target = discordId();
    const mod = discordId();
    const data = { name: 'предупреждение', options: [{ name: 'потребител', value: target }, { name: 'причина', value: 'спам' }] };
    expect(content(await answerInteraction(db(), ix({ type: 2, user: mod, data })))).toContain('Нямаш право');
    expect(content(await answerInteraction(db(), ix({ type: 2, user: mod, perms: String(1n << 40n), data })))).toContain('предупреден');
    const rows = await db().select().from(discordSanctions).where(eq(discordSanctions.discordUserId, target));
    expect(rows).toHaveLength(1);
    expect(await outbox(`mod-dm:${target}`)).toHaveLength(1);
    expect((await outbox('mod-log:warnings')).length).toBeGreaterThan(0);
  });
});

describe('giveaways', () => {
  it('linked players join; the worker draws once and pays ТрансКоин once', async () => {
    fake.state.channels = [{ id: 'c-give', name: '🎁┃раздавания', type: 0, position: 0 }];
    const start = await answerInteraction(db(), ix({ type: 2, user: discordId(), perms: ADMIN, data: { name: 'раздаване', options: [{ name: 'награда', value: 50 }, { name: 'часове', value: 1 }, { name: 'заглавие', value: 'Тест' }, { name: 'победители', value: 2 }] } }));
    await start.later!();
    const [g] = await db().select().from(discordGiveaways).where(eq(discordGiveaways.title, 'Тест'));
    expect(g!.messageId).toBeTruthy();
    const a = await linkedPlayer();
    const b = await linkedPlayer();
    for (const p of [a, b]) expect((await answerInteraction(db(), ix({ type: 3, user: p.discordId, data: { custom_id: `give:join:${g!.id}` } }))).response.type).toBe(7);
    expect(content(await answerInteraction(db(), ix({ type: 3, user: a.discordId, data: { custom_id: `give:join:${g!.id}` } })))).toContain('Вече участваш');
    // Not linked: a hint.
    expect(content(await answerInteraction(db(), ix({ type: 3, user: discordId(), data: { custom_id: `give:join:${g!.id}` } })))).toContain('Свържи');

    const later = new Date(Date.now() + 2 * 3_600_000);
    await drawGiveaways(db(), later);
    await drawGiveaways(db(), later);
    const paid = await db().select().from(coinEntries).where(eq(coinEntries.reason, 'giveaway'));
    expect(paid.filter((e) => [a.userId, b.userId].includes(e.userId))).toHaveLength(2);
  });
});

describe('the game from Discord', () => {
  it('/курс: the truck takes a load the same way as in the game', async () => {
    const p = await linkedPlayer();
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
    const contract = await makeContract('Sofia', 'Plovdiv', { goods: 'Тестов товар', rewardCents: 9_999_00 });
    const ctx = await makeCtx(db(), ix({ type: 3, user: p.discordId, data: { custom_id: `course:truck:${truck!.id}` } }));
    expect(JSON.stringify(await truckLoads(ctx, truck!.id, 'reply'))).toContain(contract.id);
    const go = await courseGo(ctx, truck!.id, contract.id);
    expect(content(go)).toContain('Камионът тръгна');
    const [after] = await db().select().from(vehicles).where(eq(vehicles.id, truck!.id));
    expect(after!.status).toBe('on_delivery');
  });

  it('company polls get a message in the company channel and votes count in the game', async () => {
    const owner = await playerWithCompany();
    const id = discordId();
    await db().update(users).set({ discordId: id }).where(eq(users.id, owner.userId));
    const poll = await createPoll(db(), owner.userId, { question: 'Къде строим?', options: ['Склад', 'Сервиз'], hours: 24 });
    await db().update(organizations).set({ discordChannelId: 'c-company' }).where(eq(organizations.id, poll.organizationId));
    await syncCompanyPolls(db());
    const [posted] = await db().select().from(companyPolls).where(eq(companyPolls.id, poll.id));
    expect(posted!.discordMessageId).toBeTruthy();
    const voted = await answerInteraction(db(), ix({ type: 3, user: id, data: { custom_id: `poll:${poll.id}:1` } }));
    expect(voted.response.type).toBe(7);
    const [vote] = await db().select().from(companyPollVotes).where(and(eq(companyPollVotes.pollId, poll.id), eq(companyPollVotes.userId, owner.userId)));
    expect(vote!.option).toBe(1);
  });

  it('pick-your-pings roles are toggled by a button', async () => {
    fake.state.roles = [];
    const id = discordId();
    const on = await answerInteraction(db(), ix({ type: 3, user: id, data: { custom_id: 'ping:events' } }));
    expect(content(on)).toContain('Ще те споменаваме');
    const role = fake.state.roles.find((r) => r.name === '🔔 Ивенти')!;
    expect(fake.state.calls.some((c) => c.method === 'PUT' && c.path.endsWith(`/members/${id}/roles/${role.id}`))).toBe(true);
    const off = await answerInteraction(db(), ix({ type: 3, user: id, roles: [role.id], data: { custom_id: 'ping:events' } }));
    expect(content(off)).toContain('Спрях');
  });
});

describe('log', () => {
  it('a deleted message is logged with the text the worker saw', async () => {
    rememberMessage({ id: 'msg-1', channel_id: 'c-chat', content: 'тайна', author: { id: 'u-1' } });
    await messageDeleted(db(), { id: 'msg-1', channel_id: 'c-chat' });
    const [row] = (await outbox('log:delete:msg-1')).slice(-1);
    expect(JSON.stringify(row!.payload)).toContain('тайна');
  });
});

import { generateKeyPairSync, sign } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// As released (before the date these are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true, featureDate: () => new Date('2026-01-01T00:00:00Z') }));
import { RELEASES, releaseByVersion } from '@/lib/game/releases';
import { withLocale } from '@/i18n/als';
import { closeDb } from '@/server/db/client';
import { companyMessages, discordOutbox, jobState, notifications, organizations, userBadges, users } from '@/server/db/schema';
import { announceFromGame, releaseAnnouncement } from '@/server/discord/announce';
import { runCommand } from '@/server/discord/commands';
import { answerInteraction } from '@/server/discord/interaction';
import { messageFromDiscord } from '@/server/discord/gateway';
import { channelPermissions } from '@/server/discord/diagnose';
import { channelKey } from '@/server/discord/guild';
import { linkDiscord, unlinkDiscord } from '@/server/discord/link';
import { bridgeCompanyChat, relayNotifications } from '@/server/discord/relay';
import { verifyDiscordSignature } from '@/server/discord/verify';
import { sendChatMessage } from '@/server/game/chat';
import { GameError } from '@/server/game/errors';
import { joinCompany, updateSettings } from '@/server/game/membership';
import { notify } from '@/server/game/notify';
import { db, newPlayer, playerWithCompany } from './helpers';

const keys = generateKeyPairSync('ed25519');
const publicHex = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');
const signed = (body: string, ts = '1700000000') => ({ 'x-signature-ed25519': sign(null, Buffer.from(ts + body), keys.privateKey).toString('hex'), 'x-signature-timestamp': ts });

beforeAll(() => {
  Object.assign(process.env, { DISCORD_BOT_TOKEN: 'test-token', DISCORD_APPLICATION_ID: '111', DISCORD_GUILD_ID: '222', DISCORD_PUBLIC_KEY: publicHex, DISCORD_CLIENT_SECRET: 'secret' });
});
afterAll(() => {
  for (const k of ['DISCORD_BOT_TOKEN', 'DISCORD_APPLICATION_ID', 'DISCORD_GUILD_ID', 'DISCORD_PUBLIC_KEY', 'DISCORD_CLIENT_SECRET']) delete process.env[k];
  return closeDb();
});

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
let n = 0;
const discordId = () => `9${Date.now()}${++n}`;
const outbox = async (prefix: string) => (await db().select().from(discordOutbox)).filter((r) => r.dedupeKey.startsWith(prefix));

describe('channel names', () => {
  it('finds the bot channels with emoji, separators and #', () => {
    for (const name of ['обновления', '#обновления', '📢-обновления', '📢︱обновления', '📢・обновления', '📢обновления', 'обновления-📢', '📢-ОБНОВЛЕНИЯ', '💻||обновления', '💻-||-обновления', '💻ǀǀобновления', '💻│обновления', '💻∣∣обновления', '💻ㅣㅣобновления', '💻ӀӀобновления']) expect(channelKey(name)).toBe('обновления');
    expect(channelKey('стари-обновления')).not.toBe('обновления');
  });

  it('works out what the bot may do in a locked channel', () => {
    const VIEW = 1n << 10n;
    const SEND = 1n << 11n;
    const base = VIEW | SEND;
    const locked = { id: 'c', name: 'обновления', type: 0, permission_overwrites: [{ id: 'g', type: 0, allow: '0', deny: String(VIEW | SEND) }] };
    expect(channelPermissions(base, locked, 'g', ['botrole'], 'bot') & SEND).toBe(0n);
    const allowed = { ...locked, permission_overwrites: [...locked.permission_overwrites, { id: 'botrole', type: 0, allow: String(VIEW | SEND), deny: '0' }] };
    expect(channelPermissions(base, allowed, 'g', ['botrole'], 'bot') & SEND).toBe(SEND);
    // Administrator ignores the channel's overwrites.
    expect(channelPermissions(base | (1n << 3n), locked, 'g', [], 'bot') & SEND).toBe(SEND);
  });
});

describe('interactions', () => {
  it('only signed requests from Discord are answered; PING gets PONG', async () => {
    const { POST } = await import('@/app/api/discord/interactions/route');
    const body = JSON.stringify({ type: 1 });
    expect(verifyDiscordSignature(publicHex, signed(body)['x-signature-ed25519'], '1700000000', body)).toBe(true);
    expect(verifyDiscordSignature(publicHex, signed(body)['x-signature-ed25519'], '1700000001', body)).toBe(false);
    const bad = await POST(new Request('http://x/api/discord/interactions', { method: 'POST', body, headers: { 'x-signature-ed25519': '00'.repeat(64), 'x-signature-timestamp': '1' } }));
    expect(bad.status).toBe(401);
    const ok = await POST(new Request('http://x/api/discord/interactions', { method: 'POST', body, headers: signed(body) }));
    expect(await ok.json()).toEqual({ type: 1 });
    const cmd = JSON.stringify({ type: 2, data: { name: 'помощ' }, member: { user: { id: '1' } } });
    const help = await (await POST(new Request('http://x/api/discord/interactions', { method: 'POST', body: cmd, headers: signed(cmd) }))).json();
    expect(help.type).toBe(4);
    expect(help.data.embeds[0].title).toBe('🚚 Команди за играчите');
  });

  it('commands read the game; personal ones need a linked account', async () => {
    const p = await playerWithCompany('Sofia');
    const [u] = await db().select().from(users).where(eq(users.id, p.userId));
    const profile = await runCommand(db(), { name: 'профил', options: { 'играч': u!.username }, discordUserId: '1' });
    expect(profile.embeds![0]!.title).toContain(u!.username);
    expect((await runCommand(db(), { name: 'профил', options: { 'играч': 'няма-такъв' }, discordUserId: '1' })).content).toMatch(/Няма играч/);
    expect((await runCommand(db(), { name: 'камиони', options: {}, discordUserId: 'unknown' })).content).toMatch(/Свържи/);
    const id = discordId();
    await linkDiscord(db(), p.userId, { id, name: 'Тест' });
    const trucks = await runCommand(db(), { name: 'камиони', options: {}, discordUserId: id });
    expect(trucks.ephemeral).toBe(true);
    expect(trucks.embeds![0]!.description).toMatch(/🚚/);
    expect((await runCommand(db(), { name: 'компания', options: {}, discordUserId: id })).embeds![0]!.title).toContain('Тест');
    expect((await runCommand(db(), { name: 'класация', options: { 'вид': 'companies' }, discordUserId: id })).embeds![0]!.title).toBe('Класация · Компании');
    expect((await runCommand(db(), { name: 'борса', options: { 'град': 'София' }, discordUserId: id })).embeds![0]!.title).toBe('Борса · София');
    // /дневна has its own handler now, with a "Вземи наградата" button.
    const daily = JSON.stringify((await answerInteraction(db(), { type: 2, data: { name: 'дневна' }, member: { user: { id } } })).response);
    expect(daily).toMatch(/Наградата за днес/);
    expect(daily).toContain('daily:claim');
  });
});

describe('linking', () => {
  it('one game account per Discord account; a reward the first time only', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    const id = discordId();
    await linkDiscord(db(), a.userId, { id, name: 'Шофьор' });
    expect(await code(linkDiscord(db(), b.userId, { id, name: 'Друг' }))).toBe('discord_taken');
    const coins = (await db().select({ c: users.coins }).from(users).where(eq(users.id, a.userId)))[0]!.c;
    expect(coins).toBe(10);
    expect(await db().select().from(userBadges).where(eq(userBadges.userId, a.userId))).toEqual(expect.arrayContaining([expect.objectContaining({ badge: 'discord' })]));
    await unlinkDiscord(db(), a.userId);
    await linkDiscord(db(), a.userId, { id, name: 'Шофьор' });
    expect((await db().select({ c: users.coins }).from(users).where(eq(users.id, a.userId)))[0]!.c).toBe(10);
    expect((await outbox('strip:')).some((r) => r.payload.discordId === id)).toBe(true);
  });
});

describe('chat bridge and direct messages', () => {
  it('company chat goes to Discord; a member writing in the Discord channel appears in the game, once', async () => {
    const owner = await playerWithCompany('Sofia');
    const [org] = await db().select().from(organizations).where(eq(organizations.ownerId, owner.userId));
    const channel = `c${discordId()}`;
    await db().update(organizations).set({ discordChannel: true, discordChannelId: channel, discordWebhook: '1/abc' }).where(eq(organizations.id, org!.id));
    await bridgeCompanyChat(db()); // starts the cursor
    await updateSettings(db(), owner.userId, { recruitment: 'open', minJoinLevel: 1, contributionRate: 0.05 });
    const member = await newPlayer();
    await joinCompany(db(), member.userId, org!.id);
    const memberDiscord = discordId();
    await linkDiscord(db(), member.userId, { id: memberDiscord, name: 'Член' });

    const gameMsg = await sendChatMessage(db(), owner.userId, 'Здравейте от играта!');
    await bridgeCompanyChat(db());
    expect((await outbox(`bridge:${gameMsg}`))[0]).toMatchObject({ target: `company:${org!.id}` });

    const event = { id: `m${discordId()}`, channel_id: channel, guild_id: '222', content: 'Здравейте от Discord!', author: { id: memberDiscord } };
    expect(await messageFromDiscord(db(), event)).toBe(true);
    expect(await messageFromDiscord(db(), event)).toBe(false);
    // Not a member, a bot or another server: ignored.
    expect(await messageFromDiscord(db(), { ...event, id: 'x1', author: { id: 'stranger' } })).toBe(false);
    expect(await messageFromDiscord(db(), { ...event, id: 'x2', author: { id: memberDiscord, bot: true } })).toBe(false);
    expect(await messageFromDiscord(db(), { ...event, id: 'x3', guild_id: 'other' })).toBe(false);
    const fromDiscord = await db().select().from(companyMessages).where(eq(companyMessages.discordMessageId, event.id));
    expect(fromDiscord).toHaveLength(1);
    // It does not go back to Discord.
    await bridgeCompanyChat(db());
    expect(await outbox(`bridge:${fromDiscord[0]!.id}`)).toHaveLength(0);
  });

  it('notifications come as a Discord message unless the player turned the category off', async () => {
    const p = await newPlayer();
    const id = discordId();
    await linkDiscord(db(), p.userId, { id, name: 'DM' });
    await relayNotifications(db()); // cursor
    await notify(db(), p.userId, 'info', 'Камионът пристигна', 'В София.', '/game/fleet');
    await relayNotifications(db());
    const [dm] = await outbox(`dm:${p.userId}:`);
    expect(dm).toMatchObject({ target: `dm:${id}` });
    await db().update(users).set({ discordPrefs: { deliveries: false } }).where(eq(users.id, p.userId));
    await notify(db(), p.userId, 'info', 'Камионът пристигна отново', 'Във Варна.', '/game/fleet');
    await relayNotifications(db());
    expect(await outbox(`dm:${p.userId}:`)).toHaveLength(1);
    void notifications;
  });
});

describe('announcements', () => {
  it('a release is announced once, in the days after it goes live', async () => {
    const r = releaseByVersion('1.3')!;
    const at = new Date(new Date(r.publishedAt).getTime() + 3_600_000);
    await announceFromGame(db(), at);
    await announceFromGame(db(), at);
    // Once per language (v2.0): the Bulgarian channel and the English and Russian ones.
    expect((await outbox('release:1.3')).map((r) => r.target).sort()).toEqual(['channel:updates', 'channel:updates@en', 'channel:updates@ru']);
  });

  it('1.1.3.2: every release of the last two weeks is announced once, oldest first — also two on the same day', async () => {
    const at = new Date('2026-10-29T20:00:00+02:00');
    // Other test files share the database and may have marked these releases already.
    for (const v of ['1.1.3.1', '1.1.3.2']) {
      await db().delete(jobState).where(eq(jobState.key, `announced:release:${v}`));
      await db().delete(discordOutbox).where(like(discordOutbox.dedupeKey, `release:${v}%`));
    }
    await announceFromGame(db(), at);
    await announceFromGame(db(), at);
    const a = await outbox('release:1.1.3.1');
    const b = await outbox('release:1.1.3.2');
    expect(a.map((x) => x.target).sort()).toEqual(['channel:updates', 'channel:updates@en', 'channel:updates@ru']);
    expect(b).toHaveLength(3);
    expect(Math.max(...a.map((x) => x.id))).toBeLessThan(Math.min(...b.map((x) => x.id)));
  });

  it('1.1.4: a release is announced a few days late too, once; one older than two weeks never', async () => {
    const r = releaseByVersion('1.5')!;
    const late = new Date(new Date(r.publishedAt).getTime() + 5 * 86_400_000);
    await announceFromGame(db(), late);
    await announceFromGame(db(), late);
    expect((await outbox('release:1.5')).map((x) => x.target).sort()).toEqual(['channel:updates', 'channel:updates@en', 'channel:updates@ru']);
    expect(await outbox('release:1.4')).toHaveLength(0);
  });

  it('the release message carries the whole notes within Discord limits, in the channel language', () => {
    for (const r of RELEASES) {
      for (const lang of ['bg', 'en', 'ru'] as const) {
        const m = withLocale(lang, () => releaseAnnouncement(r));
        const e = m.embeds[0]!;
        expect(e.description.length).toBeLessThanOrEqual(4096);
        expect(e.fields.length).toBeLessThanOrEqual(25);
        for (const f of e.fields) expect(f.value.length).toBeLessThanOrEqual(1024);
        expect(e.title.length + e.description.length + e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0) + m.content.length).toBeLessThanOrEqual(6000);
      }
    }
    const small = releaseByVersion('1.1.3')!;
    const bg = releaseAnnouncement(small);
    expect(bg.embeds[0]!.fields.map((f) => f.name)).toEqual(small.sections.map((s) => s.title));
    const en = withLocale('en', () => releaseAnnouncement(small));
    expect(en.embeds[0]!.description).not.toContain(small.tagline);
  });
});

import { like } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { closeDb } from '@/server/db/client';
import { discordOutbox } from '@/server/db/schema';
import { LOCALE_CHANNELS } from '@/server/discord/config';
import { LAYOUT } from '@/server/discord/layout';
import { announceRallyFinish } from '@/server/discord/rally';
import { localizedCommands } from '@/server/discord/register';
import { channelKey } from '@/server/discord/guild';
import { db } from './helpers';

afterAll(() => closeDb());

describe('v2.0 Discord in three languages', () => {
  it('an announcement goes to the Bulgarian, English and Russian channels, each in its language', async () => {
    Object.assign(process.env, { DISCORD_BOT_TOKEN: 'test-token', DISCORD_APPLICATION_ID: 'app', DISCORD_GUILD_ID: 'g1' });
    const key = `i18n-${Date.now()}`;
    await announceRallyFinish(db(), key, { username: 'Тест', minutes: 245, fuelCentsPer100: 9000, from: 'София', to: 'Варна' }, new Date());
    const rows = await db().select().from(discordOutbox).where(like(discordOutbox.dedupeKey, `rally-finish:${key}%`));
    const by = Object.fromEntries(rows.map((r) => [r.target, (r.payload as { content: string }).content]));
    expect(Object.keys(by).sort()).toEqual(['channel:rally', 'channel:rally@en', 'channel:rally@ru']);
    expect(by['channel:rally']).toContain('финишира София → Варна');
    expect(by['channel:rally@en']).toContain('finished Sofia → Varna');
    expect(by['channel:rally@ru']).toContain('финишировал София → Варна');
    for (const k of ['DISCORD_BOT_TOKEN', 'DISCORD_APPLICATION_ID', 'DISCORD_GUILD_ID']) delete process.env[k];
  });

  it('every language channel is in the server layout', () => {
    const keys = new Set(LAYOUT.flatMap((c) => c.channels.map((ch) => channelKey(ch.key))));
    for (const lang of ['en', 'ru'] as const) for (const name of Object.values(LOCALE_CHANNELS[lang])) expect(keys.has(channelKey(name!))).toBe(true);
  });

  it('the slash commands carry valid English and Russian names and descriptions', () => {
    const name = /^[-_\p{Ll}\p{Lo}\p{N}]{1,32}$/u;
    const all = localizedCommands() as { name_localizations?: Record<string, string>; description_localizations?: Record<string, string>; options?: unknown[] }[];
    expect(all.every((c) => c.name_localizations?.['en-US'] && c.name_localizations.ru)).toBe(true);
    const walk = (x: { name_localizations?: Record<string, string>; description_localizations?: Record<string, string>; options?: unknown[] }) => {
      for (const v of Object.values(x.description_localizations ?? {})) expect(v.length).toBeLessThanOrEqual(100);
      for (const o of (x.options ?? []) as typeof x[]) {
        for (const v of Object.values(o.name_localizations ?? {})) expect(v).toMatch(name);
        walk(o);
      }
    };
    all.forEach(walk);
    // Slash commands need lower-case names; message commands (right click → Apps, type 3) may have capitals and spaces.
    for (const c of all as { type?: number; name_localizations?: Record<string, string> }[]) for (const v of Object.values(c.name_localizations ?? {})) expect(v).toMatch(c.type === 3 ? /^.{1,32}$/u : name);
  });
});

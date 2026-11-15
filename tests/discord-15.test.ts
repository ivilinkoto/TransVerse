import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { closeDb } from '@/server/db/client';
import { organizations } from '@/server/db/schema';
import { weeklyDigest } from '@/server/discord/digest';
import { GameError } from '@/server/game/errors';
import { db } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const orgOf = async (userId: string) => (await db().select().from(organizations).where(eq(organizations.ownerId, userId)))[0]!;

describe('Discord in v1.5', () => {
  it('the weekly digest counts last week', async () => {
    Object.assign(process.env, { DISCORD_BOT_TOKEN: 'test-token', DISCORD_APPLICATION_ID: 'app', DISCORD_GUILD_ID: 'g1' });
    const d = await weeklyDigest(db(), new Date());
    expect(d.totals.n).toBeGreaterThanOrEqual(0);
    expect(d.key).toMatch(/^W\d{4}-\d{2}$/);
    for (const k of ['DISCORD_BOT_TOKEN', 'DISCORD_APPLICATION_ID', 'DISCORD_GUILD_ID']) delete process.env[k];
  });
});

import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { PREDICTIONS } from '@/lib/game/predictions';
import { closeDb } from '@/server/db/client';
import { companyBattles, discordOutbox, organizations, predictions, users } from '@/server/db/schema';
import { weeklyDigest } from '@/server/discord/digest';
import { announceRallyFinish } from '@/server/discord/rally';
import { GameError } from '@/server/game/errors';
import { predictBattle, predictionBoard, settlePredictions } from '@/server/game/predictions';
import { db, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const orgOf = async (userId: string) => (await db().select().from(organizations).where(eq(organizations.ownerId, userId)))[0]!;

describe('predictions', () => {
  it('free picks, a weekly limit, coins for a right one', async () => {
    const a = await orgOf((await playerWithCompany()).userId);
    const b = await orgOf((await playerWithCompany()).userId);
    const now = new Date();
    const [battle] = await db().insert(companyBattles).values({ weekKey: `T${Date.now()}`, aId: a.id, bId: b.id, endsAt: new Date(now.getTime() + 5 * 86_400_000), createdAt: now }).returning();
    const p = await newPlayer();
    expect(await code(predictBattle(db(), p.userId, battle!.id, p.userId))).toBe('bad_pick');
    await predictBattle(db(), p.userId, battle!.id, a.id);
    expect(await code(predictBattle(db(), p.userId, battle!.id, b.id))).toBe('already');
    expect((await predictionBoard(db(), p.userId, now)).battles.find((x) => x.id === battle!.id)!.pick).toBe(a.id);
    const coins0 = (await db().select().from(users).where(eq(users.id, p.userId)))[0]!.coins;
    await db().update(companyBattles).set({ status: 'done', winnerId: a.id }).where(eq(companyBattles.id, battle!.id));
    await settlePredictions(db());
    await settlePredictions(db());
    expect((await db().select().from(users).where(eq(users.id, p.userId)))[0]!.coins).toBe(coins0 + PREDICTIONS.coins);
    const [row] = await db().select().from(predictions).where(and(eq(predictions.userId, p.userId), eq(predictions.battleId, battle!.id)));
    expect(row!.correct).toBe(true);
  });
});

describe('Discord in v1.5', () => {
  it('a rally finish goes to #рали once; the weekly digest counts last week', async () => {
    Object.assign(process.env, { DISCORD_BOT_TOKEN: 'test-token', DISCORD_APPLICATION_ID: 'app', DISCORD_GUILD_ID: 'g1' });
    await announceRallyFinish(db(), 'test-entry', { username: 'Тест', minutes: 245, fuelCentsPer100: 9000, from: 'София', to: 'Варна' }, new Date());
    await announceRallyFinish(db(), 'test-entry', { username: 'Тест', minutes: 245, fuelCentsPer100: 9000, from: 'София', to: 'Варна' }, new Date());
    const queued = await db().select().from(discordOutbox).where(eq(discordOutbox.dedupeKey, 'rally-finish:test-entry'));
    expect(queued).toHaveLength(1);
    expect(queued[0]!.target).toBe('channel:rally');
    const d = await weeklyDigest(db(), new Date());
    expect(d.totals.n).toBeGreaterThanOrEqual(0);
    expect(d.key).toMatch(/^W\d{4}-\d{2}$/);
    for (const k of ['DISCORD_BOT_TOKEN', 'DISCORD_APPLICATION_ID', 'DISCORD_GUILD_ID']) delete process.env[k];
  });
});

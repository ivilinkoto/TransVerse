import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { HITCHHIKE, hitchhikeFare, hitchhikerFor, landmarksAlong } from '@/lib/game/road-life';
import { closeDb } from '@/server/db/client';
import { companies, deliveries, hitchhikers, ledgerEntries, userPostcards, vehicles } from '@/server/db/schema';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { pickHitchhiker, postcardsOf } from '@/server/game/road-life';
import { cityByName, db, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));

describe('v1.8 life along the road', () => {
  it('finds the landmarks a line passes, also on long straight pieces', () => {
    // Sofia → Athens as a straight line passes nowhere near the Acropolis start… but ends there.
    expect(landmarksAlong([[42.6977, 23.3219], [37.9838, 23.7275]]).map((l) => l.id)).toContain('acropolis');
    expect(landmarksAlong([[42.6977, 23.3219], [43.2141, 27.9147]]).map((l) => l.id)).not.toContain('acropolis');
    expect(hitchhikeFare(10)).toBe(HITCHHIKE.minCents);
    expect(hitchhikeFare(100_000)).toBe(HITCHHIKE.maxCents);
    const hits = Array.from({ length: 400 }, (_, i) => hitchhikerFor(`00000000-0000-0000-0000-${String(i).padStart(12, '0')}`)).filter((x) => x !== null).length;
    expect(hits / 400).toBeGreaterThan(0.08);
    expect(hits / 400).toBeLessThan(0.25);
  });

  it('a trip to Plovdiv brings the postcard of the ancient theatre; a hitchhiker taken along pays on arrival', async () => {
    const p = await newPlayer();
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
    const d = await acceptContract(db(), p.userId, (await makeContract('Sofia', 'Plovdiv')).id, truck!.id);
    // Whoever the dice chose, put a known hitchhiker on this trip.
    await db().delete(hitchhikers).where(eq(hitchhikers.deliveryId, d.id));
    const [row] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
    const sofia = await cityByName('Sofia');
    const [h] = await db().insert(hitchhikers).values({ userId: p.userId, deliveryId: d.id, persona: 0, fromCityId: sofia.id, toCityId: sofia.id, fareCents: 77_00, waitUntil: new Date(row!.startedAt.getTime() + 30 * 60_000) }).returning();
    const other = await newPlayer();
    expect(await code(pickHitchhiker(db(), other.userId, h!.id))).toBe('not_found');
    expect((await pickHitchhiker(db(), p.userId, h!.id)).aboard).toBe(true);
    expect(await code(pickHitchhiker(db(), p.userId, h!.id))).toBe('not_waiting');
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), acc!.id);
    const fare = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, acc!.id), eq(ledgerEntries.category, 'hitchhiker')));
    expect(fare.map((f) => f.amountCents)).toEqual([77_00]);
    expect((await db().select().from(userPostcards).where(eq(userPostcards.userId, p.userId))).map((c) => c.landmark)).toContain('plovdiv-theatre');
    expect((await postcardsOf(db(), p.userId)).find((c) => c.id === 'plovdiv-theatre')?.collectedAt).toBeTruthy();
  });
});

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { powerUnitModel } from '@/lib/game/catalog';
import { parseCosmetic, stickerText } from '@/lib/game/cosmetics';
import { tripCosts } from '@/lib/game/economy';
import { MOODS, marketSalaryCents } from '@/lib/game/moods';
import { buildGameTrip } from '@/lib/game/schedule';
import { closeDb } from '@/server/db/client';
import { companies, drivers, users, vehicles } from '@/server/db/schema';
import { adjustCoins } from '@/server/admin';
import { acceptContract } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { answerDriver, driverMoods } from '@/server/game/moods';
import { buyShopItem } from '@/server/game/shop';
import { db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const account = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const truck = async (userId: string) => (await db().select().from(vehicles).where(and(eq(vehicles.companyId, (await account(userId)).id), sql`${vehicles.soldAt} is null`)))[0]!;

describe('electric trucks', () => {
  it('stop to charge on long legs and pay for energy, not diesel', () => {
    const ev = powerUnitModel('volta-e19');
    const leg = { km: 600, durationS: 600 * 60, borderKms: [] };
    const trip = buildGameTrip({ startAt: 0, empty: null, loaded: leg, speedFactor: 1, charging: { everyKm: Math.round(ev.electric!.rangeKm * 0.9), minutes: ev.electric!.chargeMin } });
    expect(trip.segments.filter((s) => s.kind === 'charge').length).toBe(2);
    const plain = buildGameTrip({ startAt: 0, empty: null, loaded: leg, speedFactor: 1 });
    expect(trip.segments.at(-1)!.end).toBeGreaterThan(plain.segments.at(-1)!.end);

    const base = { trailer: null, upgrades: [], condition: 100, driverSkill: 1, emptyKm: 0, loadedKm: 300, tons: 5, payloadTons: 8, tolledRoute: { empty: true, loaded: true } };
    const e = tripCosts({ ...base, unit: ev });
    const d = tripCosts({ ...base, unit: powerUnitModel('hemus-r12-box') });
    expect(e.fuelLitres).toBe(0);
    expect(e.fuelCents).toBeGreaterThan(0);
    expect(e.tollCents).toBeLessThan(d.tollCents);
  });
});

describe('drivers with a character', () => {
  it('a poorly paid driver gets an offer; a raise keeps them, a day off stops the truck', async () => {
    const p = await playerWithCompany('Sofia');
    const acc = await account(p.userId);
    const t = await truck(p.userId);
    await db().update(drivers).set({ vehicleId: null }).where(eq(drivers.companyId, acc.id));
    const [d] = await db().insert(drivers).values({ companyId: acc.id, name: 'Иван Тестов', skill: 2, salaryCentsPerDay: Math.round(marketSalaryCents(2) * 0.5), vehicleId: t.id, loyalty: MOODS.offerBelow + 1 }).returning();
    const now = new Date();
    await driverMoods(db(), now, () => 1);
    let [row] = await db().select().from(drivers).where(eq(drivers.id, d!.id));
    expect(row!.loyalty).toBe(MOODS.offerBelow + 1 - MOODS.lowDaily);
    expect(row!.request).toBe('offer');
    await answerDriver(db(), p.userId, d!.id, true, now);
    [row] = await db().select().from(drivers).where(eq(drivers.id, d!.id));
    expect(row!.request).toBeNull();
    expect(row!.salaryCentsPerDay).toBe(Math.round(d!.salaryCentsPerDay * (1 + MOODS.counterShare)));
    expect(await code(answerDriver(db(), p.userId, d!.id, true, now))).toBe('no_request');

    // A day off: the truck waits for the driver.
    await db().update(drivers).set({ request: 'vacation', requestAt: now }).where(eq(drivers.id, d!.id));
    await answerDriver(db(), p.userId, d!.id, true, now);
    const c = await makeContract('Sofia', 'Plovdiv');
    expect(await code(acceptContract(db(), p.userId, c.id, t.id))).toBe('vacation');
  });

  it('an offer left unanswered: the driver leaves', async () => {
    const p = await playerWithCompany('Sofia');
    const acc = await account(p.userId);
    const asked = new Date(Date.now() - (MOODS.answerHours + 1) * 3_600_000);
    const [d] = await db().insert(drivers).values({ companyId: acc.id, name: 'Петър Тестов', skill: 1, salaryCentsPerDay: 5000, request: 'offer', requestAt: asked, loyalty: 10 }).returning();
    await driverMoods(db(), new Date(), () => 1);
    expect(await db().select().from(drivers).where(eq(drivers.id, d!.id))).toHaveLength(0);
  });
});

describe('truck cosmetics', () => {
  it('parts are bought with coins; the sticker needs a company', async () => {
    expect(parseCosmetic('grille:gold')).toEqual({ part: 'grille', style: 'gold' });
    expect(parseCosmetic('grille:pink')).toBeNull();
    expect(stickerText(' Дунав Транс Логистик ООД ')).toBe('ДУНАВ ТРАНС ЛОГИ');
    const admin = await newPlayer();
    await db().update(users).set({ role: 'admin' }).where(eq(users.id, admin.userId));
    const staff = { id: admin.userId, role: 'admin' as const, username: admin.username };

    const p = await playerWithCompany('Sofia');
    const t = await truck(p.userId);
    await db().update(vehicles).set({ ownership: 'owned' }).where(eq(vehicles.id, t.id));
    expect(await code(buyShopItem(db(), p.userId, { item: 'truck_part', vehicleId: t.id, cosmetic: 'lights:blue' }))).toBe('insufficient_coins');
    await adjustCoins(db(), staff, p.userId, 300, 'тест');
    await buyShopItem(db(), p.userId, { item: 'truck_part', vehicleId: t.id, cosmetic: 'lights:blue' });
    await buyShopItem(db(), p.userId, { item: 'truck_part', vehicleId: t.id, cosmetic: 'sticker:on' });
    expect(await code(buyShopItem(db(), p.userId, { item: 'truck_part', vehicleId: t.id, cosmetic: 'lights:blue' }))).toBe('already_fitted');
    const [v] = await db().select().from(vehicles).where(eq(vehicles.id, t.id));
    expect(v!.cosmetics.lights).toBe('blue');
    expect(v!.cosmetics.sticker).toMatch(/^ТЕСТ /);
    expect((await db().select().from(users).where(eq(users.id, p.userId)))[0]!.coins).toBe(300 - 80 - 70);

    const solo = await newPlayer();
    await adjustCoins(db(), staff, solo.userId, 100, 'тест');
    expect(await code(buyShopItem(db(), solo.userId, { item: 'truck_part', vehicleId: (await truck(solo.userId)).id, cosmetic: 'sticker:on' }))).toMatch(/no_company|rented/);
  });
});

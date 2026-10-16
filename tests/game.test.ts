import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { authenticate, loginSchema, registerSchema } from '@/server/auth/accounts';
import { createSession, validateSession } from '@/server/auth/session';
import { closeDb, getDb } from '@/server/db/client';
import { achievements, companies, contracts, deliveries, drivers, ledgerEntries, seasonScores, seasons, trailers, vehicles } from '@/server/db/schema';
import { replenishMarket } from '@/server/game/contracts';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { buyTrailer, buyVehicle, coupleTrailer, installUpgrade, repairVehicle } from '@/server/game/fleet';
import { rotateSeasons } from '@/server/game/seasons';
import { runPayroll } from '@/server/game/staff';
import { worldTick } from '@/server/game/world';
import { approximateProvider, valhallaProvider } from '@/server/geo/routing';
import { cityByName, db, makeContract, newPlayer } from './helpers';

afterAll(async () => closeDb());

const companyOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const fleetOf = async (companyId: string) => db().select().from(vehicles).where(eq(vehicles.companyId, companyId));
const expectGameError = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toBeInstanceOf(GameError);
  await p.catch((e: GameError) => expect(e.code).toBe(code));
};

describe('registration and authentication', () => {
  it('registers a player with a company and a starter kit', async () => {
    const { userId, hq } = await newPlayer('Plovdiv');
    const company = await companyOf(userId);
    expect(company.balanceCents).toBe(60_000_00);
    expect(company.hqCityId).toBe(hq.id);
    const fleet = await fleetOf(company.id);
    expect(fleet).toHaveLength(1);
    const [driver] = await db().select().from(drivers).where(eq(drivers.companyId, company.id));
    expect(driver?.vehicleId).toBe(fleet[0]!.id);
    const ledger = await db().select().from(ledgerEntries).where(eq(ledgerEntries.companyId, company.id));
    expect(ledger.map((l) => l.category)).toEqual(['starting_capital']);
  });

  it('validates input and rejects duplicates', async () => {
    expect(registerSchema.safeParse({ email: 'x', username: 'a', password: 'short', companyName: 'X', hqCityId: 1 }).success).toBe(false);
    const { userId } = await newPlayer();
    const [user] = await db().execute<{ email: string; username: string }>(sql`select email, username from users where id = ${userId}`).then((r) => r.rows);
    const { register } = await import('@/server/auth/accounts');
    const sofia = await cityByName('Sofia');
    await expectGameError(register(db(), { email: user!.email.toUpperCase(), username: 'someone_else', password: 'correct horse battery', companyName: 'Друга', hqCityId: sofia.id }), 'email_taken');
  });

  it('authenticates with correct password only and validates sessions', async () => {
    const { userId } = await newPlayer();
    const [u] = await db().execute<{ username: string }>(sql`select username from users where id = ${userId}`).then((r) => r.rows);
    await expectGameError(authenticate(db(), loginSchema.parse({ login: u!.username, password: 'wrong password!!' })), 'invalid_credentials');
    expect(await authenticate(db(), { login: u!.username.toUpperCase(), password: 'correct horse battery' })).toBe(userId);

    const { token } = await createSession(db(), userId);
    expect((await validateSession(db(), token))?.user.id).toBe(userId);
    expect(await validateSession(db(), 'forged-token')).toBeNull();
  });

  it('rejects a headquarters outside Bulgaria', async () => {
    const { register } = await import('@/server/auth/accounts');
    const bucharest = await cityByName('Bucharest');
    await expectGameError(register(db(), { email: 'hq@example.com', username: 'hq_test', password: 'correct horse battery', companyName: 'HQ Тест', hqCityId: bucharest.id }), 'invalid_hq');
  });
});

describe('real geography', () => {
  it('contains real cities with correct countries and coordinates', async () => {
    const sofia = await cityByName('Sofia');
    expect(sofia.countryCode).toBe('BG');
    expect(sofia.nameBg).toBe('София');
    expect(sofia.lat).toBeCloseTo(42.7, 1);
    expect(sofia.lon).toBeCloseTo(23.32, 1);
    const bucharest = await cityByName('Bucharest');
    expect(bucharest.countryCode).toBe('RO');
    expect(bucharest.nameBg).toBe('Букурещ');
    const vienna = await cityByName('Vienna');
    expect(vienna.countryCode).toBe('AT');
  });

  it('labels approximations explicitly', async () => {
    const r = await approximateProvider.route({ lat: 42.7, lon: 23.3, country: 'BG' }, { lat: 44.43, lon: 26.1, country: 'RO' }, 'truck');
    expect(r.provider).toBe('approximate');
    expect(r.geometry).toBeNull();
    expect(r.borders).toHaveLength(1);
  });

  it('computes a real truck route through Valhalla when the service is reachable', async (ctx) => {
    const reachable = await fetch('https://valhalla1.openstreetmap.de/status', { signal: AbortSignal.timeout(5000) }).then((r) => r.ok).catch(() => false);
    if (!reachable) ctx.skip('Valhalla public instance not reachable from this environment');
    const r = await valhallaProvider('https://valhalla1.openstreetmap.de').route({ lat: 42.6975, lon: 23.3242, country: 'BG' }, { lat: 42.1539, lon: 24.75, country: 'BG' }, 'truck');
    expect(r.provider).toBe('valhalla');
    expect(r.distanceKm).toBeGreaterThan(120);
    expect(r.distanceKm).toBeLessThan(180);
    expect(r.geometry).toBeTruthy();
    expect(r.borders).toHaveLength(0);
    // German city centres restrict heavy trucks; snapping to major roads must still find a route.
    const de = await valhallaProvider('https://valhalla1.openstreetmap.de').route({ lat: 48.137, lon: 11.575, country: 'DE' }, { lat: 52.52, lon: 13.405, country: 'DE' }, 'truck');
    expect(de.distanceKm).toBeGreaterThan(550);
  });
});

describe('freight market and deliveries', () => {
  it('stocks the shared market and guarantees van jobs at every HQ', async () => {
    const { hq } = await newPlayer('Varna');
    await replenishMarket(db(), new Date(), approximateProvider);
    const open = await db().select().from(contracts).where(eq(contracts.status, 'open'));
    expect(open.length).toBeGreaterThan(10);
    expect(open.filter((c) => c.originCityId === hq.id && c.weightTons <= 1.3).length).toBeGreaterThanOrEqual(2);
    for (const c of open) expect(c.originCityId).not.toBe(c.destCityId);
  });

  it('accepts a compatible contract and rejects an incompatible one', async () => {
    const { userId } = await newPlayer();
    const company = await companyOf(userId);
    const [van] = await fleetOf(company.id);
    const bulk = await makeContract('Sofia', 'Plovdiv', { cargoType: 'bulk', weightTons: 20, goods: 'Зърно' });
    await expectGameError(acceptContract(db(), userId, bulk.id, van!.id), 'incompatible');
    const heavy = await makeContract('Sofia', 'Plovdiv', { weightTons: 5 });
    await expectGameError(acceptContract(db(), userId, heavy.id, van!.id), 'incompatible');

    const ok = await makeContract('Sofia', 'Plovdiv');
    const delivery = await acceptContract(db(), userId, ok.id, van!.id);
    expect(delivery.status).toBe('in_progress');
    expect((await fleetOf(company.id))[0]!.status).toBe('on_delivery');
    const second = await makeContract('Sofia', 'Plovdiv');
    await expectGameError(acceptContract(db(), userId, second.id, van!.id), 'vehicle_busy');
  });

  it('lets only one company win a contract under concurrent requests', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    const vanA = (await fleetOf((await companyOf(a.userId)).id))[0]!;
    const vanB = (await fleetOf((await companyOf(b.userId)).id))[0]!;
    const contract = await makeContract('Sofia', 'Pernik');
    const results = await Promise.allSettled([acceptContract(db(), a.userId, contract.id, vanA.id), acceptContract(db(), b.userId, contract.id, vanB.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rows = await db().select().from(deliveries).where(eq(deliveries.contractId, contract.id));
    expect(rows).toHaveLength(1);
  });

  it('pays a finished delivery exactly once, even when settled concurrently', async () => {
    const { userId } = await newPlayer();
    const company = await companyOf(userId);
    const [van] = await fleetOf(company.id);
    const contract = await makeContract('Sofia', 'Plovdiv', { rewardCents: 400_00 });
    const delivery = await acceptContract(db(), userId, contract.id, van!.id);

    // Not due yet → nothing happens.
    expect(await settleDueDeliveries(db(), new Date(delivery.etaAt.getTime() - 60_000), company.id)).toBe(0);

    const later = new Date(delivery.etaAt.getTime() + 1000);
    const counts = await Promise.all([settleDueDeliveries(db(), later, company.id), settleDueDeliveries(db(), later, company.id), settleDueDeliveries(db(), later, company.id)]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await settleDueDeliveries(db(), later, company.id)).toBe(0);

    const freight = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, company.id), eq(ledgerEntries.category, 'freight')));
    expect(freight).toHaveLength(1);
    expect(freight[0]!.amountCents).toBe(400_00);

    const after = await companyOf(userId);
    const [{ sum }] = (await db().execute<{ sum: string }>(sql`select sum(amount_cents) as sum from ledger_entries where company_id = ${company.id}`)).rows as [{ sum: string }];
    expect(after.balanceCents).toBe(Number(sum)); // balance always equals the ledger
    expect(after.deliveries).toBe(1);
    expect(after.reputation).toBeGreaterThan(0);

    const [movedVan] = await fleetOf(company.id);
    expect(movedVan!.status).toBe('idle');
    expect(movedVan!.cityId).toBe(contract.destCityId);
    expect(movedVan!.condition).toBeLessThan(van!.condition);

    const unlocked = await db().select().from(achievements).where(eq(achievements.userId, userId));
    expect(unlocked.map((a) => a.key)).toContain('first_delivery');
    const rewards = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, company.id), eq(ledgerEntries.category, 'achievement_reward')));
    expect(rewards).toHaveLength(1);
  });

  it('penalises late delivery', async () => {
    const { userId } = await newPlayer();
    const company = await companyOf(userId);
    const [van] = await fleetOf(company.id);
    const contract = await makeContract('Sofia', 'Burgas', { windowMinutes: 30 });
    const d = await acceptContract(db(), userId, contract.id, van!.id);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1), company.id);
    const [row] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
    expect(row!.late).toBe(true);
    const penalty = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, company.id), eq(ledgerEntries.category, 'penalty')));
    expect(penalty).toHaveLength(1);
  });

  it('drives empty to the pickup first and follows EU rest rules on long hauls', async () => {
    const { userId } = await newPlayer();
    const company = await companyOf(userId);
    const [van] = await fleetOf(company.id);
    const contract = await makeContract('Plovdiv', 'Munich');
    const d = await acceptContract(db(), userId, contract.id, van!.id);
    const schedule = d.schedule as { kind: string; leg: string }[];
    expect(schedule[0]!.leg).toBe('empty');
    expect(schedule.some((s) => s.kind === 'rest')).toBe(true);
    expect(schedule.some((s) => s.kind === 'border')).toBe(true);
    expect(d.emptyKm).toBeGreaterThan(100);
  });
});

describe('fleet, finance and staff', () => {
  it('buys vehicles, enforces funds and depot capacity', async () => {
    const { userId, hq } = await newPlayer();
    const company = await companyOf(userId);
    await buyVehicle(db(), userId, 'sokol-courier', hq.id);
    // 60 000 − 34 000 + 2 000 reward for the "second vehicle" achievement
    expect((await companyOf(userId)).balanceCents).toBe(60_000_00 - 34_000_00 + 2_000_00);
    await expectGameError(buyVehicle(db(), userId, 'hemus-r12-box', hq.id), 'insufficient_funds');
    await db().update(companies).set({ balanceCents: 200_000_00 }).where(eq(companies.id, company.id));
    await buyVehicle(db(), userId, 'sokol-courier', hq.id);
    await expectGameError(buyVehicle(db(), userId, 'sokol-courier', hq.id), 'no_capacity');
    await expectGameError(buyVehicle(db(), userId, 'danubia-t440', hq.id), 'level');
  });

  it('couples trailers, installs upgrades and repairs', async () => {
    const { userId, hq } = await newPlayer();
    const company = await companyOf(userId);
    await db().update(companies).set({ balanceCents: 1_000_000_00 }).where(eq(companies.id, company.id));
    await db().execute(sql`update users set level = 3, xp = 99999 where id = ${userId}`);
    const tractor = await buyVehicle(db(), userId, 'danubia-t440', hq.id);
    const trailer = await buyTrailer(db(), userId, 'tipper-26', hq.id);
    await coupleTrailer(db(), userId, tractor.id, trailer.id);
    expect((await db().select().from(trailers).where(eq(trailers.id, trailer.id)))[0]!.vehicleId).toBe(tractor.id);
    await installUpgrade(db(), userId, tractor.id, 'eco_tune');
    await expectGameError(installUpgrade(db(), userId, tractor.id, 'eco_tune'), 'already_installed');
    await db().update(vehicles).set({ condition: 70 }).where(eq(vehicles.id, tractor.id));
    expect(await repairVehicle(db(), userId, tractor.id)).toBeGreaterThan(0);
  });

  it('runs payroll once per day', async () => {
    const { userId } = await newPlayer();
    const company = await companyOf(userId);
    await runPayroll(db(), '2026-01-01');
    await runPayroll(db(), '2026-01-01');
    const salaries = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, company.id), eq(ledgerEntries.category, 'salaries')));
    expect(salaries).toHaveLength(1);
  });
});

describe('persistent world', () => {
  it('completes deliveries in the background worker without any client', async () => {
    const { userId } = await newPlayer();
    const company = await companyOf(userId);
    const [van] = await fleetOf(company.id);
    const contract = await makeContract('Sofia', 'Pernik');
    const d = await acceptContract(db(), userId, contract.id, van!.id);
    await worldTick(db(), new Date(d.etaAt.getTime() + 1000), approximateProvider);
    const [row] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
    expect(row!.status).toBe('completed');
  });

  it('keeps all data after a restart (new connection pool)', async () => {
    const { userId } = await newPlayer();
    const before = await companyOf(userId);
    await closeDb();
    const after = (await getDb().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
    expect(after).toEqual(before);
  });

  it('rotates seasons without touching company assets', async () => {
    const { userId } = await newPlayer();
    const company = await companyOf(userId);
    const [season] = await db().insert(seasons).values({ name: 'Тестов сезон', startsAt: new Date(Date.now() - 2 * 86_400_000), endsAt: new Date(Date.now() - 1000), status: 'active', rules: { lengthDays: 1, prizesCents: [1_000_00] } }).returning();
    await db().update(seasons).set({ status: 'finished' }).where(sql`${seasons.id} <> ${season!.id} and ${seasons.status} = 'active'`);
    await db().insert(seasonScores).values({ seasonId: season!.id, companyId: company.id, points: 999_999, deliveries: 5, revenueCents: 0 });
    const fleetBefore = await fleetOf(company.id);
    expect(await rotateSeasons(db())).toBe(1);
    const [score] = await db().select().from(seasonScores).where(and(eq(seasonScores.seasonId, season!.id), eq(seasonScores.companyId, company.id)));
    expect(score!.finalRank).toBe(1);
    expect(await fleetOf(company.id)).toEqual(fleetBefore);
    expect((await companyOf(userId)).balanceCents).toBe(company.balanceCents + 1_000_00);
    const active = await db().select().from(seasons).where(eq(seasons.status, 'active'));
    expect(active).toHaveLength(1);
  });
});


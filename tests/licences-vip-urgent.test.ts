import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { contractCountries, requiredLicences } from '@/lib/game/licences';
import { gameDurationMinutes } from '@/lib/game/schedule';
import { rentalFeeCents } from '@/lib/game/economy';
import { isVip } from '@/lib/game/vip';
import { setVip } from '@/server/admin';
import { closeDb } from '@/server/db/client';
import { cities, companies, contracts, drivers, notifications, userLicences, users, vehicles } from '@/server/db/schema';
import { ensureLocalJob } from '@/server/game/contracts';
import { acceptContract } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { buyVehicle } from '@/server/game/fleet';
import { buyLicence } from '@/server/game/licences';
import { approximateProvider } from '@/server/geo/routing';
import { createUrgentContract } from '@/server/urgent';
import { cityByName, db, makeContract, newPlayer } from './helpers';

afterAll(async () => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const truckOf = async (companyId: string) => (await db().select().from(vehicles).where(and(eq(vehicles.companyId, companyId), sql`${vehicles.soldAt} is null`)))[0]!;
const fund = (companyId: string, cents: number) => db().update(companies).set({ balanceCents: cents }).where(eq(companies.id, companyId));
const staff = async (role: 'admin' | 'support') => {
  const p = await newPlayer();
  await db().update(users).set({ role }).where(eq(users.id, p.userId));
  return { id: p.userId, role, username: p.username };
};

describe('licence rules', () => {
  it('derives licences from cargo and the countries a route passes', () => {
    expect(requiredLicences('pallets', ['BG'])).toEqual([]);
    expect(requiredLicences('pallets', ['BG', 'RO'])).toEqual(['international']);
    expect(requiredLicences('pallets', ['BG', 'RS', 'HU'])).toEqual(['international', 'customs']);
    expect(requiredLicences('refrigerated', ['BG'])).toEqual(['reefer']);
    expect(requiredLicences('liquid', ['TR'])).toEqual(['adr']); // domestic Turkey: no customs
    expect(requiredLicences('special', ['BG', 'TR'])).toEqual(['international', 'customs', 'oversize']);
    expect(contractCountries('BG', 'DE', ['BG', 'RS', 'HU', 'AT', 'DE'])).toEqual(['BG', 'DE', 'RS', 'HU', 'AT']);
  });
});

describe('licences in the game', () => {
  it('blocks cross-border jobs without a licence and allows them after buying it', async () => {
    const p = await newPlayer();
    const account = await accountOf(p.userId);
    const truck = await truckOf(account.id);
    const abroad = await makeContract('Sofia', 'Thessaloníki');
    expect(await code(acceptContract(db(), p.userId, abroad.id, truck.id))).toBe('licence_required');

    expect(await code(buyLicence(db(), p.userId, 'international'))).toBe('level');
    await db().update(users).set({ level: 3 }).where(eq(users.id, p.userId));
    expect(await code(buyLicence(db(), p.userId, 'customs'))).toBe('licence_prerequisite');
    expect(await code(buyLicence(db(), p.userId, 'rail'))).toBe('licence_unavailable');
    await fund(account.id, 2_000_00);
    expect(await code(buyLicence(db(), p.userId, 'international'))).toBe('insufficient_funds');
    await fund(account.id, 10_000_00);
    await buyLicence(db(), p.userId, 'international');
    expect((await accountOf(p.userId)).balanceCents).toBe(10_000_00 - 3_000_00);
    expect(await code(buyLicence(db(), p.userId, 'international'))).toBe('licence_owned');
    expect(await code(acceptContract(db(), p.userId, abroad.id, truck.id))).toBe('ok');
  });

  it('the guaranteed local job stays inside the country without cross-border licences', async () => {
    const p = await newPlayer('Varna');
    const varna = await cityByName('Varna');
    // Clear Varna's open jobs so a new one has to be created.
    await db().update(contracts).set({ status: 'expired' }).where(and(eq(contracts.originCityId, varna.id), eq(contracts.status, 'open')));
    expect(await ensureLocalJob(db(), { cityId: varna.id, bodies: ['box'], payloadTons: 7.5, level: 1, licences: new Set() }, new Date(), approximateProvider)).toBe(3);
    const jobs = await db()
      .select({ country: cities.countryCode, cargo: contracts.cargoType })
      .from(contracts)
      .innerJoin(cities, eq(cities.id, contracts.destCityId))
      .where(and(eq(contracts.originCityId, varna.id), eq(contracts.status, 'open')));
    expect(jobs.length).toBe(3);
    for (const job of jobs) {
      expect(job.country).toBe('BG');
      expect(job.cargo).toBe('pallets');
    }
    expect(p.hq.id).toBe(varna.id);
  });
});

describe('buying without a company', () => {
  it('an independent driver has a depot from the start and buys a truck', async () => {
    const p = await newPlayer();
    const account = await accountOf(p.userId);
    await fund(account.id, 100_000_00);
    // 1.1.2: the start city's depot comes with the account.
    const truck = await buyVehicle(db(), p.userId, 'sokol-courier', p.hq.id);
    expect(truck.companyId).toBe(account.id);
    expect((await accountOf(p.userId)).kind).toBe('independent');
  });
});

describe('VIP', () => {
  it('only administrators grant VIP for a set number of days, and it can be removed', async () => {
    const admin = await staff('admin');
    const support = await staff('support');
    const p = await newPlayer();
    expect(await code(setVip(db(), support, p.userId, 30))).toBe('forbidden');
    const until = await setVip(db(), admin, p.userId, 30);
    const [u] = await db().select().from(users).where(eq(users.id, p.userId));
    expect(isVip(u!.vipUntil, new Date())).toBe(true);
    expect(Math.round((until!.getTime() - Date.now()) / 86_400_000)).toBe(30);
    expect(isVip(u!.vipUntil, until!.getTime() + 1)).toBe(false);
    await setVip(db(), admin, p.userId, 0);
    expect((await db().select().from(users).where(eq(users.id, p.userId)))[0]!.vipUntil).toBeNull();
    expect(await code(setVip(db(), admin, p.userId, 5000))).toBe('invalid_days');
  });
});

describe('urgent shipments', () => {
  it('administrators publish them; they are listed first and driven faster', async () => {
    const admin = await staff('admin');
    const support = await staff('support');
    const sofia = await cityByName('Sofia');
    const plovdiv = await cityByName('Plovdiv');
    const input = { goods: 'Медицинско оборудване', cargoType: 'pallets' as const, weightTons: 1, rewardEur: 3000, originCityId: sofia.id, destCityId: plovdiv.id, windowMinutes: 60, speedFactor: 2, expiresHours: 6, announce: true };
    expect(await code(createUrgentContract(db(), support, input, approximateProvider))).toBe('forbidden');
    expect(await code(createUrgentContract(db(), admin, { ...input, windowMinutes: 5 }, approximateProvider))).toBe('window_too_short');
    expect(await code(createUrgentContract(db(), admin, { ...input, destCityId: sofia.id }, approximateProvider))).toBe('same_city');

    const urgent = await createUrgentContract(db(), admin, input, approximateProvider);
    expect(urgent.urgent).toBe(true);
    expect(urgent.rewardCents).toBe(3000_00);
    const player = await newPlayer('Sofia');
    const [note] = await db().select().from(notifications).where(and(eq(notifications.userId, admin.id), sql`${notifications.title} like 'Спешна доставка%'`));
    expect(note).toBeDefined();

    // Non-VIP players may take it once the 5-minute VIP head start is over.
    const open = new Date(urgent.createdAt.getTime() + 6 * 60_000);
    const truck = await truckOf((await accountOf(player.userId)).id);
    const d = await acceptContract(db(), player.userId, urgent.id, truck.id, open);
    const minutes = (d.etaAt.getTime() - d.startedAt.getTime()) / 60_000;
    expect(minutes).toBeCloseTo(gameDurationMinutes(d.loadedKm) / 2, 0);
    expect((d.deadlineAt.getTime() - d.startedAt.getTime()) / 60_000).toBe(60);
    // The same player cannot take it twice; it stays open for everyone else.
    const [second] = await db().insert(vehicles).values({ companyId: truck.companyId, modelId: 'hemus-r12-box', plate: 'TEST-2', color: '#fff', cityId: truck.cityId, purchasePriceCents: 0 }).returning();
    await db().update(drivers).set({ vehicleId: second!.id }).where(eq(drivers.vehicleId, truck.id));
    expect(await code(acceptContract(db(), player.userId, urgent.id, second!.id, open))).toBe('already_taken');
    expect((await db().select().from(contracts).where(eq(contracts.id, urgent.id)))[0]!.status).toBe('open');

    // A truck in another city reaches the pickup in one minute, then drives the cargo.
    const far = await newPlayer('Varna');
    const farTruck = await truckOf((await accountOf(far.userId)).id);
    const d2 = await acceptContract(db(), far.userId, urgent.id, farTruck.id, open);
    const segments = d2.schedule as { leg: string; start: number; end: number }[];
    const empty = segments.filter((x) => x.leg === 'empty');
    expect(d2.emptyKm).toBeGreaterThan(300);
    expect(empty).toHaveLength(1);
    expect(empty[0]!.end - empty[0]!.start).toBe(60_000);
    expect((d2.etaAt.getTime() - d2.startedAt.getTime()) / 60_000).toBeCloseTo(1 + gameDurationMinutes(d2.loadedKm) / 2, 0);
    // The relocation is free: the rental fee covers only the cargo leg.
    expect(d2.rentalFeeCents).toBe(rentalFeeCents(3000_00, d2.loadedKm));

    // After it leaves the board nobody else can take it.
    await db().update(contracts).set({ expiresAt: new Date(open.getTime() - 1000) }).where(eq(contracts.id, urgent.id));
    const late = await newPlayer('Sofia');
    expect(await code(acceptContract(db(), late.userId, urgent.id, (await truckOf((await accountOf(late.userId)).id)).id, open))).toBe('contract_unavailable');
  });
});

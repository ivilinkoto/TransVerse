import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { RENTAL_BUYOUT_DELIVERIES, rentalBuyoutCents } from '@/lib/game/catalog';
import { serviceState } from '@/lib/game/economy';
import { companyLicencePrice } from '@/lib/game/licences';
import { headingWest } from '@/lib/geo/geometry';
import { closeDb } from '@/server/db/client';
import { companies, companyMessages, companyRanks, contracts, drivers, jobState, ledgerEntries, notifications, organizations, treasuryEntries, vehicles } from '@/server/db/schema';
import { autoUrgentTick, publishAutoUrgent } from '@/server/game/auto-urgent';
import { clearCompanyChat, companyChat, sendChatMessage } from '@/server/game/chat';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { buyVehicle } from '@/server/game/fleet';
import { post } from '@/server/game/finance';
import { buyCompanyLicence, heldLicences } from '@/server/game/licences';
import { depositToTreasury, joinCompany, setMemberRank, updateSettings } from '@/server/game/membership';
import { plate, uniquePlate } from '@/server/game/names';
import { buyoutRental } from '@/server/game/rentals';
import { approximateProvider } from '@/server/geo/routing';
import { db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(async () => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const activeTrucks = async (companyId: string) => db().select().from(vehicles).where(and(eq(vehicles.companyId, companyId), isNull(vehicles.soldAt)));
const orgOf = async (userId: string) => (await db().select().from(organizations).where(eq(organizations.ownerId, userId)))[0]!;
const fund = async (companyId: string, cents: number, key: string) => db().transaction((tx) => post(tx, companyId, [{ category: 'admin_adjustment', amountCents: cents, description: 'test funds', idempotencyKey: key }]));

/** One delivery with the given truck, settled on arrival. */
async function deliver(userId: string, vehicleId: string, from: string, to: string) {
  const contract = await makeContract(from, to);
  const d = await acceptContract(db(), userId, contract.id, vehicleId);
  await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000));
  return d;
}

describe('plates', () => {
  it('uses area prefixes and never hands out a plate that is on the road', async () => {
    for (let i = 0; i < 50; i++) expect(plate()).toMatch(/^[ABEKMHOPCTYX]{1,2} \d{4} [ABEKMHOPCTYX]{2}$/);
    expect(plate(3)).toMatch(/ [ABEKMHOPCTYX]{3}$/);
    const used = new Set((await db().select({ plate: vehicles.plate }).from(vehicles).where(isNull(vehicles.soldAt))).map((r) => r.plate));
    const fresh = new Set<string>();
    for (let i = 0; i < 40; i++) fresh.add(await uniquePlate(db()));
    expect(fresh.size).toBe(40);
    for (const p of fresh) expect(used.has(p)).toBe(false);
  });
});

describe('starter rental', () => {
  it('can be bought out at half price after five deliveries', async () => {
    const p = await newPlayer('Sofia');
    const account = await accountOf(p.userId);
    const [truck] = await activeTrucks(account.id);
    expect(truck!.ownership).toBe('rented');
    for (let i = 0; i < RENTAL_BUYOUT_DELIVERIES; i++) {
      if (i === RENTAL_BUYOUT_DELIVERIES - 1) expect(await code(buyoutRental(db(), p.userId, truck!.id))).toBe('too_early');
      await deliver(p.userId, truck!.id, i % 2 ? 'Plovdiv' : 'Sofia', i % 2 ? 'Sofia' : 'Plovdiv');
    }
    const [offer] = await db().select().from(notifications).where(and(eq(notifications.userId, p.userId), sql`${notifications.title} like 'Можеш да откупиш%'`));
    expect(offer).toBeDefined();
    const price = rentalBuyoutCents(truck!.modelId);
    expect(price).toBe(39_500_00);
    expect(await code(buyoutRental(db(), p.userId, truck!.id))).toBe('insufficient_funds');
    await fund(account.id, price, `test:buyout:${account.id}`);
    expect((await buyoutRental(db(), p.userId, truck!.id)).priceCents).toBe(price);
    const [after] = await db().select().from(vehicles).where(eq(vehicles.id, truck!.id));
    expect(after).toMatchObject({ ownership: 'owned', purchasePriceCents: price });
    const paid = await db().select().from(ledgerEntries).where(eq(ledgerEntries.idempotencyKey, `buyout:${truck!.id}`));
    expect(paid[0]!.amountCents).toBe(-price);
  });

  it('goes back when the player buys a truck — at once, or after its current trip', async () => {
    const p = await newPlayer('Sofia');
    const account = await accountOf(p.userId);
    const [rented] = await activeTrucks(account.id);
    await fund(account.id, 300_000_00, `test:fleet:${account.id}`);
    // 1.1.2: the start city's depot comes with the account.

    // On a trip: marked, and returned when it arrives; the player then drives the new truck.
    const contract = await makeContract('Sofia', 'Plovdiv');
    const d = await acceptContract(db(), p.userId, contract.id, rented!.id);
    const own = await buyVehicle(db(), p.userId, 'sokol-courier', p.hq.id);
    expect((await db().select().from(vehicles).where(eq(vehicles.id, rented!.id)))[0]!.returnPending).toBe(true);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000));
    const [gone] = await db().select().from(vehicles).where(eq(vehicles.id, rented!.id));
    expect(gone!.status).toBe('returned');
    expect(gone!.soldAt).not.toBeNull();
    const [me] = await db().select().from(drivers).where(and(eq(drivers.companyId, account.id), eq(drivers.isOwner, true)));
    expect(me!.vehicleId).toBe(own.id);

    // Idle: returned right away.
    const q = await newPlayer('Varna');
    const qa = await accountOf(q.userId);
    const [qRented] = await activeTrucks(qa.id);
    await fund(qa.id, 300_000_00, `test:fleet:${qa.id}`);
    // (the start city's depot comes with the account)
    const qOwn = await buyVehicle(db(), q.userId, 'sokol-courier', q.hq.id);
    const left = await activeTrucks(qa.id);
    expect(left.map((v) => v.id)).toEqual([qOwn.id]);
    expect((await db().select().from(vehicles).where(eq(vehicles.id, qRented!.id)))[0]!.status).toBe('returned');
  });
});

describe('company licences', () => {
  it('bought from the treasury at double price; every member may use them', async () => {
    const owner = await playerWithCompany();
    const org = await orgOf(owner.userId);
    await updateSettings(db(), owner.userId, { recruitment: 'open', minJoinLevel: 1, contributionRate: 0.05 });
    const member = await newPlayer();
    await joinCompany(db(), member.userId, org.id);

    expect(await code(buyCompanyLicence(db(), member.userId, 'international'))).toBe('forbidden');
    expect(await code(buyCompanyLicence(db(), owner.userId, 'customs'))).toBe('licence_prerequisite');
    expect(await code(buyCompanyLicence(db(), owner.userId, 'international'))).toBe('insufficient_treasury');
    await fund((await accountOf(owner.userId)).id, 10_000_00, `test:licence:${owner.userId}`);
    await depositToTreasury(db(), owner.userId, 10_000);
    expect(await code(buyCompanyLicence(db(), owner.userId, 'rail'))).toBe('licence_unavailable');
    await buyCompanyLicence(db(), owner.userId, 'international');
    expect(await code(buyCompanyLicence(db(), owner.userId, 'international'))).toBe('licence_owned');
    const [spent] = await db().select().from(treasuryEntries).where(and(eq(treasuryEntries.organizationId, org.id), eq(treasuryEntries.category, 'company_licence')));
    expect(spent!.amountCents).toBe(-companyLicencePrice('international'));
    expect(companyLicencePrice('international')).toBe(6_000_00);
    expect((await heldLicences(db(), member.userId)).has('international')).toBe(true);
    expect((await heldLicences(db(), (await newPlayer()).userId)).has('international')).toBe(false);
  });
});

describe('company chat clearing', () => {
  it('only the owner and the deputy may clear the whole chat', async () => {
    const owner = await playerWithCompany();
    const org = await orgOf(owner.userId);
    await updateSettings(db(), owner.userId, { recruitment: 'open', minJoinLevel: 1, contributionRate: 0.05 });
    const deputy = await newPlayer();
    const driver = await newPlayer();
    await joinCompany(db(), deputy.userId, org.id);
    await joinCompany(db(), driver.userId, org.id);
    const [deputyRank] = await db().select().from(companyRanks).where(and(eq(companyRanks.companyId, org.id), eq(companyRanks.name, 'Заместник')));
    await setMemberRank(db(), owner.userId, deputy.userId, deputyRank!.id);
    await sendChatMessage(db(), driver.userId, 'Здравейте');
    await sendChatMessage(db(), owner.userId, 'Добре дошъл');

    expect((await companyChat(db(), driver.userId)).canClear).toBe(false);
    expect(await code(clearCompanyChat(db(), driver.userId))).toBe('forbidden');
    expect((await companyChat(db(), deputy.userId)).canClear).toBe(true);
    expect(await clearCompanyChat(db(), deputy.userId)).toBe(2);
    expect(await db().select().from(companyMessages).where(eq(companyMessages.companyId, org.id))).toHaveLength(0);
    expect((await companyChat(db(), owner.userId)).canClear).toBe(true);
  });
});

describe('automatic urgent shipments', () => {
  it('appear at random moments and are short runs anyone can take', async () => {
    await db().delete(jobState).where(eq(jobState.key, 'auto-urgent'));
    const now = new Date();
    expect(await autoUrgentTick(db(), now, approximateProvider)).toBeUndefined();
    const [state] = await db().select().from(jobState).where(eq(jobState.key, 'auto-urgent'));
    const next = (state!.value as { next: number }).next;
    expect(next).toBeGreaterThan(now.getTime());

    const c = await publishAutoUrgent(db(), now, approximateProvider);
    expect(c).not.toBeNull();
    expect(c!).toMatchObject({ urgent: true, createdBy: null });
    expect(c!.distanceKm).toBeGreaterThan(50);
    expect(c!.rewardCents).toBeGreaterThan(0);
    expect(c!.windowMinutes).toBeGreaterThanOrEqual(20);

    // When the moment comes, it publishes and picks a new random moment 90–300 min later.
    const later = new Date(next + 1000);
    await db().update(contracts).set({ status: 'expired' }).where(and(eq(contracts.urgent, true), isNull(contracts.createdBy)));
    const published = await autoUrgentTick(db(), later, approximateProvider);
    expect(published?.urgent).toBe(true);
    const [again] = await db().select().from(jobState).where(eq(jobState.key, 'auto-urgent'));
    const gap = (again!.value as { next: number }).next - later.getTime();
    expect(gap).toBeGreaterThanOrEqual(90 * 60_000);
    expect(gap).toBeLessThanOrEqual(300 * 60_000);
  });
});

describe('small rules', () => {
  it('service advice and map heading', () => {
    expect(serviceState(80)).toBe('ok');
    expect(serviceState(40)).toBe('soon');
    expect(serviceState(10)).toBe('required');
    const eastward: [number, number][] = [[42.7, 23.3], [42.15, 24.75]]; // Sofia → Plovdiv
    expect(headingWest(eastward, 0.5)).toBe(false);
    expect(headingWest([...eastward].reverse(), 0.5)).toBe(true);
  });
});

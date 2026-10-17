import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { ECONOMY, tripCosts } from '@/lib/game/economy';
import { powerUnitModel } from '@/lib/game/catalog';
import { DIESEL_CENTS_PER_LITRE, FUEL_DAILY_SWING, fuelPriceCents, kmByCountry, legFuelPriceCents } from '@/lib/game/fuel';
import { REFERRAL } from '@/lib/game/referrals';
import { applyDueEvents, insertStop, planRoadEvents, seededRandom } from '@/lib/game/road-events';
import { buildGameSchedule, scheduleEnd, type Segment } from '@/lib/game/schedule';
import { marketFeeCents, usedPriceBounds } from '@/lib/game/used-market';
import { closeDb } from '@/server/db/client';
import { companies, deliveries, ledgerEntries, notifications, organizationSeasonScores, organizations, seasons, users, vehicleListings, vehicles } from '@/server/db/schema';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { buyVehicle } from '@/server/game/fleet';
import { post } from '@/server/game/finance';
import { attachReferral, ensureReferralCode } from '@/server/game/referrals';
import { applyDueRoadEvents } from '@/server/game/road-events';
import { activeSeason, companyPrizes, rotateSeasons } from '@/server/game/seasons';
import { buyListing, cancelListing, createListing, expireListings } from '@/server/game/used-market';
import { db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(async () => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const fund = (companyId: string, cents: number, key: string) => db().transaction((tx) => post(tx, companyId, [{ category: 'admin_adjustment', amountCents: cents, description: 'test', idempotencyKey: key }]));
const activeVehicles = (companyId: string) => db().select().from(vehicles).where(and(eq(vehicles.companyId, companyId), sql`${vehicles.soldAt} is null`));

/** Runs one Sofia → Plovdiv delivery with the player's first free vehicle and settles it. */
async function deliverOnce(userId: string) {
  const account = await accountOf(userId);
  const [v] = (await activeVehicles(account.id)).filter((x) => x.status === 'idle');
  const contract = await makeContract('Sofia', 'Plovdiv');
  const d = await acceptContract(db(), userId, contract.id, v!.id);
  await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), account.id);
  return d;
}

describe('diesel prices by country', () => {
  it('splits a leg by its border crossings and weights the price by kilometres', () => {
    expect(kmByCountry('BG', 300, [{ km: 100, to: 'RS' }, { km: 250, to: 'HU' }])).toEqual({ BG: 100, RS: 150, HU: 50 });
    expect(kmByCountry('BG', 120, [])).toEqual({ BG: 120 });
    const now = new Date('2026-10-17T10:00:00Z');
    const bg = fuelPriceCents('BG', now);
    expect(bg).toBeGreaterThanOrEqual(Math.floor(DIESEL_CENTS_PER_LITRE.BG! * (1 - FUEL_DAILY_SWING)));
    expect(bg).toBeLessThanOrEqual(Math.ceil(DIESEL_CENTS_PER_LITRE.BG! * (1 + FUEL_DAILY_SWING)));
    expect(fuelPriceCents('BG', now)).toBe(bg); // the same for everyone during the day
    const mixed = legFuelPriceCents('BG', 200, [{ km: 100, to: 'DE' }], now);
    expect(mixed).toBe(Math.round((bg + fuelPriceCents('DE', now)) / 2));
    // Unknown countries fall back to the default price (± the daily swing).
    expect(Math.abs(fuelPriceCents('ZZ', now) - ECONOMY.fuelPriceCentsPerLitre)).toBeLessThanOrEqual(Math.ceil(ECONOMY.fuelPriceCentsPerLitre * FUEL_DAILY_SWING));
  });

  it('trip fuel follows the price of each leg', () => {
    const base = { unit: powerUnitModel('hemus-r12-box'), trailer: null, upgrades: [], condition: 100, driverSkill: 1, emptyKm: 0, loadedKm: 400, tons: 2, payloadTons: 7.5, tolledRoute: { empty: false, loaded: false } };
    const cheap = tripCosts({ ...base, fuelPrice: { empty: 100, loaded: 100 } });
    const dear = tripCosts({ ...base, fuelPrice: { empty: 200, loaded: 200 } });
    expect(dear.fuelCents).toBe(cheap.fuelCents * 2);
    expect(cheap.fuelLitres).toBeGreaterThan(0);
  });
});

describe('road events', () => {
  const schedule = buildGameSchedule({ startAt: 1_000_000, empty: null, loaded: { km: 900, durationS: 9 * 3600, borderKms: [450] }, speedFactor: 1 });

  it('plans reproducibly and only inside drive segments', () => {
    const a = planRoadEvents(schedule, { totalKm: 900, borders: 1, rented: false, random: seededRandom('x1') });
    const b = planRoadEvents(schedule, { totalKm: 900, borders: 1, rented: false, random: seededRandom('x1') });
    expect(a).toEqual(b);
    let planned = 0;
    for (let i = 0; i < 200; i++) {
      const events = planRoadEvents(schedule, { totalKm: 900, borders: 1, rented: i % 2 === 0, random: seededRandom(`s${i}`) });
      planned += events.length;
      for (const e of events) {
        expect(schedule.some((s) => s.kind === 'drive' && e.at > s.start && e.at < s.end)).toBe(true);
        expect(e.delayMs).toBeGreaterThan(0);
        if (i % 2 === 0) expect(e.costCents).toBe(0); // rented: the lessor pays
      }
    }
    // Roughly 45 % of long trips have an event (some get two).
    expect(planned).toBeGreaterThan(50);
    expect(planned).toBeLessThan(160);
  });

  it('a stop pushes the rest of the trip later and keeps the kilometres continuous', () => {
    const drive = schedule.find((s) => s.kind === 'drive')!;
    const at = (drive.start + drive.end) / 2;
    const next = insertStop(schedule, at, 600_000, 'Задръстване');
    expect(scheduleEnd(next)).toBe(scheduleEnd(schedule) + 600_000);
    const stop = next.find((s) => s.kind === 'incident')!;
    expect(stop).toMatchObject({ start: at, end: at + 600_000, note: 'Задръстване' });
    for (let i = 1; i < next.length; i++) {
      expect(next[i]!.start).toBe(next[i - 1]!.end);
      if (next[i]!.leg === next[i - 1]!.leg) expect(next[i]!.fromKm).toBeCloseTo(next[i - 1]!.toKm, 6);
    }
  });

  it('applies due events once, in order, with earlier delays moving later ones', () => {
    const drives = schedule.filter((s) => s.kind === 'drive');
    const e1 = { kind: 'traffic' as const, at: drives[0]!.start + 10_000, delayMs: 120_000, costCents: 0, applied: false };
    const e2 = { kind: 'roadworks' as const, at: drives.at(-1)!.start + 10_000, delayMs: 60_000, costCents: 0, applied: false };
    const first = applyDueEvents(schedule, [e1, e2], e1.at + 1);
    expect(first.applied).toHaveLength(1);
    expect(first.nextAt).toBe(e2.at + 120_000);
    const again = applyDueEvents(first.schedule, first.events, e1.at + 1);
    expect(again.applied).toHaveLength(0);
    const both = applyDueEvents(first.schedule, first.events, e2.at + 120_001);
    expect(both.applied).toHaveLength(1);
    expect(scheduleEnd(both.schedule)).toBe(scheduleEnd(schedule) + 180_000);
    expect(both.nextAt).toBeNull();
  });

  it('the worker applies a breakdown: later arrival, repair bill, notification', async () => {
    const p = await playerWithCompany('Sofia', 60_000_00);
    await buyVehicle(db(), p.userId, 'sokol-courier', p.hq.id);
    const account = await accountOf(p.userId);
    const own = (await activeVehicles(account.id)).find((v) => v.ownership === 'owned')!;
    const contract = await makeContract('Sofia', 'Plovdiv');
    const d = await acceptContract(db(), p.userId, contract.id, own.id);
    const drive = (d.schedule as Segment[]).find((s) => s.kind === 'drive')!;
    const at = Math.round((drive.start + drive.end) / 2);
    await db().update(deliveries).set({ roadEvents: [{ kind: 'breakdown', at, delayMs: 90_000, costCents: 300_00, applied: false }], nextEventAt: new Date(at) }).where(eq(deliveries.id, d.id));

    expect(await applyDueRoadEvents(db(), new Date(at - 1000))).toBe(0);
    expect(await applyDueRoadEvents(db(), new Date(at + 1000))).toBeGreaterThanOrEqual(1);
    const [after] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
    expect(after!.etaAt.getTime()).toBe(d.etaAt.getTime() + 90_000);
    expect(after!.nextEventAt).toBeNull();
    expect((after!.schedule as Segment[]).some((s) => s.kind === 'incident' && s.note === 'Повреда по пътя')).toBe(true);
    const bill = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, account.id), eq(ledgerEntries.category, 'road_events')));
    expect(bill.map((b) => b.amountCents)).toEqual([-300_00]);
    const [note] = await db().select().from(notifications).where(and(eq(notifications.userId, p.userId), sql`${notifications.title} like 'Повреда по пътя%'`));
    expect(note).toBeDefined();

    // Not settled at the old arrival time, settled after the new one; applying again changes nothing.
    expect(await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), account.id)).toBe(0);
    expect(await settleDueDeliveries(db(), new Date(after!.etaAt.getTime() + 1000), account.id)).toBe(1);
    expect(await applyDueRoadEvents(db(), new Date(at + 5000))).toBe(0);
  });

  it('settling applies an event the worker missed before deciding', async () => {
    const p = await newPlayer();
    const account = await accountOf(p.userId);
    const [van] = await activeVehicles(account.id);
    const contract = await makeContract('Sofia', 'Plovdiv');
    const d = await acceptContract(db(), p.userId, contract.id, van!.id);
    const drive = (d.schedule as Segment[]).find((s) => s.kind === 'drive')!;
    const at = Math.round((drive.start + drive.end) / 2);
    await db().update(deliveries).set({ roadEvents: [{ kind: 'traffic', at, delayMs: 120_000, costCents: 0, applied: false }], nextEventAt: new Date(at) }).where(eq(deliveries.id, d.id));
    expect(await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), account.id)).toBe(0);
    const [moved] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
    expect(moved!.etaAt.getTime()).toBe(d.etaAt.getTime() + 120_000);
    expect(await settleDueDeliveries(db(), new Date(moved!.etaAt.getTime() + 1000), account.id)).toBe(1);
  });
});

describe('used-vehicle market', () => {
  it('prices stay within limits and the commission is 5 %', () => {
    const b = usedPriceBounds(100_000_00, 80, 100);
    expect(b.min).toBeLessThan(b.suggested);
    expect(b.suggested).toBeLessThanOrEqual(b.max);
    expect(b.max).toBe(100_000_00);
    expect(marketFeeCents(10_000_00)).toBe(500_00);
  });

  it('a player sells a truck to another player; money and ownership move once', async () => {
    const seller = await playerWithCompany('Sofia', 60_000_00);
    await buyVehicle(db(), seller.userId, 'sokol-courier', seller.hq.id);
    const sAccount = await accountOf(seller.userId);
    const truck = (await activeVehicles(sAccount.id)).find((v) => v.ownership === 'owned')!;
    const rented = (await activeVehicles(sAccount.id)).find((v) => v.ownership === 'rented');
    if (rented) expect(await code(createListing(db(), seller.userId, { kind: 'vehicle', id: rented.id, priceCents: 10_000_00 }))).toBe('rented');
    expect(await code(createListing(db(), seller.userId, { kind: 'vehicle', id: truck.id, priceCents: 100_00 }))).toBe('bad_price');
    expect(await code(createListing(db(), seller.userId, { kind: 'vehicle', id: truck.id, priceCents: 999_999_00 }))).toBe('bad_price');
    const price = 25_000_00;
    const listing = await createListing(db(), seller.userId, { kind: 'vehicle', id: truck.id, priceCents: price });
    expect((await db().select().from(vehicles).where(eq(vehicles.id, truck.id)))[0]!.status).toBe('listed');
    // A listed truck cannot take jobs.
    const job = await makeContract('Sofia', 'Plovdiv');
    expect(await code(acceptContract(db(), seller.userId, job.id, truck.id))).toBe('vehicle_busy');
    expect(await code(buyListing(db(), seller.userId, listing.id))).toBe('own_listing');

    const buyer = await playerWithCompany('Varna');
    expect(await code(buyListing(db(), buyer.userId, listing.id))).toBe('insufficient_funds');
    const bAccount = await accountOf(buyer.userId);
    await fund(bAccount.id, 30_000_00, `used-fund:${buyer.userId}`);
    const before = { s: (await accountOf(seller.userId)).balanceCents, b: (await accountOf(buyer.userId)).balanceCents };
    await buyListing(db(), buyer.userId, listing.id);
    expect(await code(buyListing(db(), buyer.userId, listing.id))).toBe('listing_unavailable');
    expect((await accountOf(seller.userId)).balanceCents).toBe(before.s + price - marketFeeCents(price));
    expect((await accountOf(buyer.userId)).balanceCents).toBe(before.b - price);
    const [moved] = await db().select().from(vehicles).where(eq(vehicles.id, truck.id));
    expect(moved).toMatchObject({ companyId: bAccount.id, status: 'idle', purchasePriceCents: price });
    const [closed] = await db().select().from(vehicleListings).where(eq(vehicleListings.id, listing.id));
    expect(closed).toMatchObject({ status: 'sold', buyerCompanyId: bAccount.id });
    const [note] = await db().select().from(notifications).where(and(eq(notifications.userId, seller.userId), sql`${notifications.title} like 'Продадено:%'`));
    expect(note).toBeDefined();
  });

  it('a withdrawn or expired listing returns the truck to work', async () => {
    const seller = await playerWithCompany('Plovdiv', 60_000_00);
    await buyVehicle(db(), seller.userId, 'sokol-courier', seller.hq.id);
    const account = await accountOf(seller.userId);
    const truck = (await activeVehicles(account.id)).find((v) => v.ownership === 'owned')!;
    const l1 = await createListing(db(), seller.userId, { kind: 'vehicle', id: truck.id, priceCents: 20_000_00 });
    await cancelListing(db(), seller.userId, l1.id);
    expect((await db().select().from(vehicles).where(eq(vehicles.id, truck.id)))[0]!.status).toBe('idle');
    const l2 = await createListing(db(), seller.userId, { kind: 'vehicle', id: truck.id, priceCents: 20_000_00 });
    expect(await expireListings(db(), new Date(Date.now() + 8 * 86_400_000))).toBeGreaterThanOrEqual(1);
    expect((await db().select().from(vehicleListings).where(eq(vehicleListings.id, l2.id)))[0]!.status).toBe('expired');
    expect((await db().select().from(vehicles).where(eq(vehicles.id, truck.id)))[0]!.status).toBe('idle');
  });
});

describe('invite a friend', () => {
  it('rewards both players once, after the invited player has made their deliveries', async () => {
    const inviter = await newPlayer();
    const codeStr = await ensureReferralCode(db(), inviter.userId);
    expect(codeStr).toMatch(/^[A-Z2-9]{8}$/);
    expect(await ensureReferralCode(db(), inviter.userId)).toBe(codeStr);
    await db().update(users).set({ signupIpHash: 'net-a' }).where(eq(users.id, inviter.userId));
    const friend = await newPlayer();
    await attachReferral(db(), friend.userId, codeStr.toLowerCase(), 'net-b');
    expect((await db().select().from(users).where(eq(users.id, friend.userId)))[0]!.referredById).toBe(inviter.userId);

    const inviterBefore = (await accountOf(inviter.userId)).balanceCents;
    for (let i = 0; i < REFERRAL.deliveriesNeeded - 1; i++) await deliverOnce(friend.userId);
    expect((await accountOf(inviter.userId)).balanceCents).toBe(inviterBefore);
    await deliverOnce(friend.userId);
    expect((await accountOf(inviter.userId)).balanceCents).toBe(inviterBefore + REFERRAL.inviterCents);
    expect((await db().select().from(users).where(eq(users.id, inviter.userId)))[0]!.coins).toBe(REFERRAL.inviterCoins);
    const bonus = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, (await accountOf(friend.userId)).id), eq(ledgerEntries.category, 'referral_reward')));
    expect(bonus.map((b) => b.amountCents)).toEqual([REFERRAL.inviteeCents]);
    // Paid once.
    await deliverOnce(friend.userId);
    expect((await accountOf(inviter.userId)).balanceCents).toBe(inviterBefore + REFERRAL.inviterCents);
  });

  it('invites from the same network and unknown codes are not rewarded', async () => {
    const inviter = await newPlayer();
    const c = await ensureReferralCode(db(), inviter.userId);
    await db().update(users).set({ signupIpHash: 'same-net' }).where(eq(users.id, inviter.userId));
    const twin = await newPlayer();
    await attachReferral(db(), twin.userId, c, 'same-net');
    const before = (await accountOf(inviter.userId)).balanceCents;
    for (let i = 0; i < REFERRAL.deliveriesNeeded; i++) await deliverOnce(twin.userId);
    expect((await accountOf(inviter.userId)).balanceCents).toBe(before);
    expect((await db().select().from(users).where(eq(users.id, twin.userId)))[0]!.referralOutcome).toBe('declined');

    const stranger = await newPlayer();
    await attachReferral(db(), stranger.userId, 'NOTACODE', null);
    expect((await db().select().from(users).where(eq(users.id, stranger.userId)))[0]!.referredById).toBeNull();
  });
});

describe('company seasons', () => {
  it("members' deliveries score for the company; the season end pays the treasury", async () => {
    const owner = await playerWithCompany('Burgas');
    const [org] = await db().select().from(organizations).where(eq(organizations.ownerId, owner.userId));
    await deliverOnce(owner.userId);
    const season = await activeSeason(db());
    const [score] = await db().select().from(organizationSeasonScores).where(and(eq(organizationSeasonScores.seasonId, season.id), eq(organizationSeasonScores.organizationId, org!.id)));
    expect(score!.points).toBeGreaterThan(0);
    expect(score!.deliveries).toBe(1);

    const treasuryBefore = (await db().select().from(organizations).where(eq(organizations.id, org!.id)))[0]!.treasuryCents;
    await db().update(seasons).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(seasons.id, season.id));
    expect(await rotateSeasons(db())).toBe(1);
    const [final] = await db().select().from(organizationSeasonScores).where(and(eq(organizationSeasonScores.seasonId, season.id), eq(organizationSeasonScores.organizationId, org!.id)));
    expect(final!.finalRank).toBeGreaterThanOrEqual(1);
    const prize = companyPrizes(season.rules as never)[final!.finalRank! - 1] ?? 0;
    const [after] = await db().select().from(organizations).where(eq(organizations.id, org!.id));
    expect(after!.treasuryCents).toBe(treasuryBefore + prize);
    // A new season is open.
    expect((await activeSeason(db())).id).not.toBe(season.id);
  });
});

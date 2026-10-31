import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));

import { adOffers } from '@/lib/game/ads';
import { CARGO, CARGO_TYPES } from '@/lib/game/cargo';
import { co2Week, quotaKg } from '@/lib/game/co2';
import { FEATURES } from '@/lib/game/features';
import { FOG_AREAS, fogAt, foggyAreas, isFogSeason } from '@/lib/game/fog';
import { PUZZLE, puzzleFill, puzzlePieces, puzzleShare } from '@/lib/game/loading-puzzle';
import { CLUES, clueText, culpritOf } from '@/lib/game/lost-cargo';
import { promiseOutcome } from '@/lib/game/promise';
import { compareVersions, releaseByVersion } from '@/lib/game/releases';
import { starsFor } from '@/lib/game/reviews';
import { techCost } from '@/lib/game/research';
import { closeDb } from '@/server/db/client';
import { adContracts, co2Credits, co2Weeks, companies, contracts, deliveries, deliveryExtras, drivers, driverWishes, interviews, ledgerEntries, lostCases, organizations, playerChallenges, tripQueue, users, vehicles } from '@/server/db/schema';
import { runAction } from '@/server/game/actions';
import { recordAdKm, takeAd } from '@/server/game/ads';
import { settleCo2Weeks } from '@/server/game/co2';
import { acceptContract, settleDelivery } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { post } from '@/server/game/finance';
import { giftLoad } from '@/server/game/gifts';
import { buyPolicy, setInsurancePlan } from '@/server/game/insurers';
import { answerInterview, offerInterview, openInterview } from '@/server/game/interviews';
import { runLaneRepeats, setLaneRepeat } from '@/server/game/lane-repeat';
import { accuse, caseOf, lookClue } from '@/server/game/lost-cargo';
import { hireOffice, officeEffects, trainOffice } from '@/server/game/office';
import { createChallenge, joinChallenge, recordChallengeRun, settlePlayerChallenges } from '@/server/game/player-challenges';
import { researchOf, startResearch } from '@/server/game/research';
import { respondFriendRequest, sendFriendRequest } from '@/server/game/social';
import { checkTripRules, ensureLivestockLoads } from '@/server/game/special-loads';
import { runPayroll } from '@/server/game/staff';
import { trackLink, trackView } from '@/server/game/tracking';
import { moveQueued, queueTrip, queuedTrips } from '@/server/game/trip-queue';
import { puzzleFor, starsOf, submitPuzzle } from '@/server/game/trip-extras';
import { setVacation } from '@/server/game/vacation';
import { recordWishDelivery, spawnWishes } from '@/server/game/wishes';
import { db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const account = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const truckOf = async (companyId: string) => (await db().select().from(vehicles).where(eq(vehicles.companyId, companyId)))[0]!;
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const fund = (companyId: string, cents: number, key: string) => db().transaction((tx) => post(tx, companyId, [{ category: 'admin_adjustment', amountCents: cents, description: 'test', idempotencyKey: `${key}:${companyId}` }]));
const ledger = async (companyId: string, category: string) => db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, companyId), eq(ledgerEntries.category, category)));
const user = (id: string) => ({ id, role: 'player', username: 'p' });
const ip = async () => '127.0.0.1';

async function settleOnTime(deliveryId: string) {
  const [row] = await db().select().from(deliveries).where(eq(deliveries.id, deliveryId));
  await db().transaction((tx) => settleDelivery(tx, deliveryId, new Date(row!.etaAt.getTime() + 60_000)));
}

describe('v1.1.4.2 „Мъгла и марки“ — rules', () => {
  it('ships tomorrow at 8:00, after 1.1.4.1 and before 1.2, with its features', () => {
    const r = releaseByVersion('1.1.4.2')!;
    expect(r.name).toBe('Мъгла и марки');
    expect(r.publishedAt).toBe('2026-11-01T08:00:00+02:00');
    expect(compareVersions('1.1.4.2', '1.1.4.1')).toBe(1);
    expect(new Date(r.publishedAt) < new Date(releaseByVersion('1.2')!.publishedAt)).toBe(true);
    for (const f of ['load_promise', 'loading_puzzle', 'client_reviews', 'mystery_client', 'fog', 'research', 'office', 'livestock', 'co2', 'night_courier', 'last_mile'] as const) expect(FEATURES[f]).toBe('1.1.4.2');
  });

  it('the promise: fast pays when kept and costs when broken; easy forgives half a penalty', () => {
    const times = { startedAt: 0, deadlineAt: 100, completedAt: 60 };
    expect(promiseOutcome('fast', times, 1000, 0)).toMatchObject({ kept: true, cents: 150 });
    expect(promiseOutcome('fast', { ...times, completedAt: 90 }, 1000, 0)).toMatchObject({ kept: false, cents: -100, reputation: -2 });
    expect(promiseOutcome('easy', { ...times, completedAt: 120 }, 1000, 200).cents).toBe(-50 + 100);
  });

  it('the loading puzzle: the same pieces for a trip, overlaps refused, a full floor pays the most', () => {
    const pieces = puzzlePieces('trip-1');
    expect(puzzlePieces('trip-1')).toEqual(pieces);
    const area = pieces.reduce((s, p) => s + p.w * p.h, 0);
    expect(area).toBeGreaterThan(PUZZLE.cols * PUZZLE.rows);
    const ones = [{ id: 0, w: 1, h: 1 }, { id: 1, w: 1, h: 1 }];
    expect(() => puzzleFill(ones, [{ id: 0, x: 0, y: 0 }, { id: 1, x: 0, y: 0 }])).toThrow('overlap');
    expect(() => puzzleFill(ones, [{ id: 0, x: PUZZLE.cols, y: 0 }])).toThrow('outside');
    expect(puzzleFill(ones, [{ id: 0, x: 0, y: 0 }])).toBeCloseTo(1 / 30);
    expect(puzzleShare(0.5)).toBe(0);
    expect(puzzleShare(1)).toBe(PUZZLE.maxShare);
  });

  it('stars: late, violations and a broken promise cost stars; never under one', () => {
    expect(starsFor({ late: false, violations: 0, promiseBroken: false, condition: 90 })).toBe(5);
    expect(starsFor({ late: true, violations: 3, promiseBroken: true, condition: 10 })).toBe(1);
  });

  it('fog: only in November, in real plains (the Danube plain has Ruse)', () => {
    expect(isFogSeason(new Date('2026-10-31T12:00:00+02:00'))).toBe(false);
    expect(foggyAreas(new Date('2026-10-31T12:00:00+02:00'))).toEqual([]);
    const danube = FOG_AREAS.find((a) => a.id === 'danube')!;
    // Ruse (43.85, 25.97) lies in it.
    expect(43.85 >= danube.lat[0] && 43.85 <= danube.lat[1] && 25.97 >= danube.lon[0] && 25.97 <= danube.lon[1]).toBe(true);
    let foggyDays = 0;
    for (let d = 1; d <= 30; d++) if (fogAt(43.85, 25.97, new Date(`2026-11-${String(d).padStart(2, '0')}T09:00:00+02:00`))) foggyDays++;
    expect(foggyDays).toBeGreaterThan(5);
    expect(foggyDays).toBeLessThan(30);
  });

  it('CO₂, adverts, research, the lost pallet: game data that adds up', () => {
    expect(co2Week(5000, quotaKg(1))).toEqual({ creditsT: 4, overT: 0 });
    expect(co2Week(10_500, quotaKg(1))).toEqual({ creditsT: 0, overT: 1.5 });
    expect(adOffers('W2026-11-02', 'c1')).toEqual(adOffers('W2026-11-02', 'c1'));
    expect(adOffers('W2026-11-02', 'c1')).toHaveLength(3);
    expect(techCost(1).cents).toBeLessThan(techCost(3).cents);
    // Exactly one clue points at the culprit.
    for (const seed of [1, 2, 3, 99]) expect(CLUES.filter((c) => clueText(seed, c).odd).map((c) => clueText(seed, c).suspect)).toEqual([culpritOf(seed)]);
  });

  it('livestock is a new cargo with its own trailer, never from the markets', () => {
    expect(CARGO_TYPES).toContain('livestock');
    expect(CARGO.livestock.bodies).toEqual(['livestock']);
  });
});

describe('v1.1.4.2 — in the game', () => {
  it('a kept fast promise and a packed trailer pay on arrival; the client gives stars', async () => {
    const p = await newPlayer();
    const acc = await account(p.userId);
    const truck = await truckOf(acc.id);
    const c = await makeContract('Sofia', 'Plovdiv');
    const r = (await runAction(db(), user(p.userId), { type: 'acceptContract', contractId: c.id, vehicleId: truck.id, rush: false, overload: false, insure: false, route: 'fast', parking: 'free', refuel: false, promise: 'fast' } as never, ip)) as { deliveryId: string };
    const puzzle = await puzzleFor(db(), p.userId, r.deliveryId);
    expect(puzzle.open).toBe(true);
    // Lay the pieces left to right, row by row, where they fit.
    const grid = Array.from({ length: PUZZLE.rows }, () => Array<boolean>(PUZZLE.cols).fill(false));
    const placements: { id: number; x: number; y: number }[] = [];
    for (const piece of puzzle.pieces) {
      outer: for (let y = 0; y + piece.h <= PUZZLE.rows; y++)
        for (let x = 0; x + piece.w <= PUZZLE.cols; x++) {
          let free = true;
          for (let yy = y; yy < y + piece.h; yy++) for (let xx = x; xx < x + piece.w; xx++) if (grid[yy]![xx]) free = false;
          if (!free) continue;
          for (let yy = y; yy < y + piece.h; yy++) for (let xx = x; xx < x + piece.w; xx++) grid[yy]![xx] = true;
          placements.push({ id: piece.id, x, y });
          break outer;
        }
    }
    const result = await submitPuzzle(db(), p.userId, r.deliveryId, placements);
    expect(result.fill).toBeGreaterThan(0.5);
    expect(await code(submitPuzzle(db(), p.userId, r.deliveryId, placements))).toBe('puzzle_done');
    await settleOnTime(r.deliveryId);
    expect((await ledger(acc.id, 'promise'))[0]?.amountCents).toBe(Math.round(c.rewardCents * 0.15));
    if (result.share > 0) expect((await ledger(acc.id, 'loading_bonus')).length).toBe(1);
    const [x] = await db().select().from(deliveryExtras).where(eq(deliveryExtras.deliveryId, r.deliveryId));
    expect(x!.stars).toBe(5);
    expect((await starsOf(db(), p.userId)).trips).toBe(1);
  });

  it('research: one level at a time, paid, counted once done', async () => {
    const p = await newPlayer();
    const acc = await account(p.userId);
    await fund(acc.id, 100_000_00, 'research');
    const now = new Date();
    await startResearch(db(), p.userId, 'aero', now);
    expect(await code(startResearch(db(), p.userId, 'telematics', now))).toBe('research_busy');
    expect((await researchOf(db(), acc.id, now)).find((r) => r.tech === 'aero')!.level).toBe(0);
    const later = new Date(now.getTime() + 7 * 3_600_000);
    expect((await researchOf(db(), acc.id, later)).find((r) => r.tech === 'aero')!.level).toBe(1);
    expect((await ledger(acc.id, 'research'))[0]!.amountCents).toBe(-techCost(1).cents);
  });

  it('the office: hire, train, the effects; the sales person pays on arrival', async () => {
    const p = await newPlayer();
    const acc = await account(p.userId);
    await fund(acc.id, 100_000_00, 'office');
    await hireOffice(db(), p.userId, 'sales');
    expect(await code(hireOffice(db(), p.userId, 'sales'))).toBe('office_taken');
    await trainOffice(db(), p.userId, 'sales');
    expect((await officeEffects(db(), acc.id)).sales).toBeCloseTo(0.04);
    const truck = await truckOf(acc.id);
    const d = await acceptContract(db(), p.userId, (await makeContract('Sofia', 'Plovdiv')).id, truck.id);
    await settleOnTime(d.id);
    expect((await ledger(acc.id, 'office_bonus')).length).toBe(1);
  });

  it('an advert pays once its kilometres are driven in its country', async () => {
    const p = await newPlayer();
    const acc = await account(p.userId);
    const offer = adOffers((await import('@/lib/game/leagues')).weekKey(new Date()), acc.id).find((o) => o.rule === 'any') ?? adOffers((await import('@/lib/game/leagues')).weekKey(new Date()), acc.id)[0]!;
    const ad = await takeAd(db(), p.userId, offer.key);
    await db().transaction((tx) => recordAdKm(tx, acc.id, p.userId, [offer.country], offer.targetKm + 10, true, new Date()));
    const [row] = await db().select().from(adContracts).where(eq(adContracts.id, ad.id));
    expect(row!.status).toBe('done');
    expect((await ledger(acc.id, 'ad_pay'))[0]!.amountCents).toBe(offer.payCents);
  });

  it('CO₂: an unused quota becomes credits, an overrun is paid on Monday', async () => {
    const p = await newPlayer();
    const acc = await account(p.userId);
    const q = await newPlayer();
    const acc2 = await account(q.userId);
    await db().insert(co2Weeks).values([{ companyId: acc.id, week: 'W2026-10-19', kg: 1000 }, { companyId: acc2.id, week: 'W2026-10-19', kg: 50_000 }]);
    await settleCo2Weeks(db(), new Date('2026-11-02T10:00:00+02:00'));
    const [credits] = await db().select().from(co2Credits).where(eq(co2Credits.companyId, acc.id));
    // A rented truck does not count, so the quota is the minimum one.
    expect(credits!.tonnes).toBeGreaterThan(0);
    expect((await ledger(acc2.id, 'co2'))[0]!.amountCents).toBeLessThan(0);
  });

  it('an insurer pays a late penalty from its treasury', async () => {
    const owner = await playerWithCompany();
    await setInsurancePlan(db(), owner.userId, { premiumCents: 100_00, coverPct: 50, maxPayoutCents: 10_000_00, active: true });
    const [org] = await db().select().from(organizations).where(eq(organizations.ownerId, owner.userId));
    await db().update(organizations).set({ treasuryCents: 50_000_00 }).where(eq(organizations.id, org!.id));
    const p = await newPlayer();
    const acc = await account(p.userId);
    await buyPolicy(db(), p.userId, org!.id);
    expect(await code(buyPolicy(db(), p.userId, org!.id))).toBe('policy_active');
    const truck = await truckOf(acc.id);
    const d = await acceptContract(db(), p.userId, (await makeContract('Sofia', 'Plovdiv', { windowMinutes: 1 })).id, truck.id);
    const [row] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
    await db().transaction((tx) => settleDelivery(tx, d.id, new Date(row!.etaAt.getTime() + 60_000)));
    const penalty = (await ledger(acc.id, 'penalty')).reduce((s, e) => s + e.amountCents, 0);
    if (penalty < 0) expect((await ledger(acc.id, 'insurance_claim'))[0]!.amountCents).toBe(Math.round((-penalty * 50) / 100));
  });

  it('the lost pallet: clues, then one accusation', async () => {
    const p = await newPlayer();
    const [c] = await db().insert(lostCases).values({ userId: p.userId, goods: 'Мебели', seed: 7 }).returning();
    await lookClue(db(), p.userId, c!.id, 'camera');
    expect((await caseOf(db(), p.userId))!.clues).toHaveLength(1);
    const r = await accuse(db(), p.userId, c!.id, culpritOf(7));
    expect(r.solved).toBe(true);
    expect(await code(accuse(db(), p.userId, c!.id, 0))).toBe('case_closed');
  });

  it('a challenge: the fastest run wins the prize', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    const accA = await account(a.userId);
    await fund(accA.id, 10_000_00, 'challenge');
    const sofia = (await makeContract('Sofia', 'Plovdiv'));
    const ch = await createChallenge(db(), a.userId, { title: 'Бързо до Пловдив', originCityId: sofia.originCityId, destCityId: sofia.destCityId, days: 1, prizeCents: 500_00, soloOnly: false });
    expect(await code(joinChallenge(db(), a.userId, ch.id))).toBe('own_challenge');
    await joinChallenge(db(), b.userId, ch.id);
    await db().transaction((tx) => recordChallengeRun(tx, b.userId, { originCityId: sofia.originCityId, destCityId: sofia.destCityId }, { minutes: 42, solo: true, deliveryId: sofia.id }, new Date()));
    await settlePlayerChallenges(db(), new Date(Date.now() + 2 * 86_400_000));
    const [row] = await db().select().from(playerChallenges).where(eq(playerChallenges.id, ch.id));
    expect(row!.winnerId).toBe(b.userId);
    expect((await ledger((await account(b.userId)).id, 'player_challenge'))[0]!.amountCents).toBe(500_00);
  });

  it('a load given to a friend is kept for them and pays 5% more', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    const c = await makeContract('Sofia', 'Plovdiv');
    expect(await code(giftLoad(db(), a.userId, c.id, b.userId))).toBe('not_friends');
    await sendFriendRequest(db(), a.userId, b.userId);
    const [f] = await db().execute<{ id: string }>(sql`select id from friendships where requester_id = ${a.userId} and addressee_id = ${b.userId}`).then((r) => r.rows);
    await respondFriendRequest(db(), b.userId, f!.id, true);
    await giftLoad(db(), a.userId, c.id, b.userId);
    const [row] = await db().select().from(contracts).where(eq(contracts.id, c.id));
    expect(row!.reservedByCompanyId).toBe((await account(b.userId)).id);
    expect(row!.rewardCents).toBe(Math.round(c.rewardCents * 1.05));
  });

  it('on vacation no new trip starts and no salaries are paid', async () => {
    const p = await newPlayer();
    const acc = await account(p.userId);
    await db().insert(drivers).values({ companyId: acc.id, name: 'Тест', skill: 1, salaryCentsPerDay: 100_00 });
    await setVacation(db(), p.userId, 3);
    expect(await code(setVacation(db(), p.userId, 3))).toBe('vacation_soon');
    const truck = await truckOf(acc.id);
    expect(await code(acceptContract(db(), p.userId, (await makeContract('Sofia', 'Plovdiv')).id, truck.id))).toBe('on_vacation');
    const day = new Date().toISOString().slice(0, 10);
    await runPayroll(db(), day);
    expect(await ledger(acc.id, 'salaries')).toHaveLength(0);
  });

  it('special loads: night courier only at night, the last mile only for vans, livestock on the board', async () => {
    const p = await newPlayer();
    const noon = new Date('2026-11-02T12:00:00+02:00');
    expect(await code(checkTripRules(db(), p.userId, { tag: 'night_courier' }, 'sokol-courier', noon))).toBe('night_only');
    expect(await code(checkTripRules(db(), p.userId, { tag: 'night_courier' }, 'sokol-courier', new Date('2026-11-02T23:00:00+02:00')))).toBe('ok');
    const truckModel = (await truckOf((await account(p.userId)).id)).modelId;
    expect(await code(checkTripRules(db(), p.userId, { tag: 'last_mile' }, 'sokol-courier', noon))).toBe('ok');
    if (truckModel !== 'sokol-courier' && truckModel !== 'sokol-cargo-72') expect(await code(checkTripRules(db(), p.userId, { tag: 'last_mile' }, truckModel, noon))).toBe('van_only');
    await ensureLivestockLoads(db(), noon);
    const [{ n = 0 } = {}] = await db().select({ n: sql<number>`count(*)::int` }).from(contracts).where(and(eq(contracts.tag, 'livestock'), eq(contracts.cargoType, 'livestock')));
    expect(n).toBeGreaterThan(0);
  });

  it('a public tracking link shows the trip without money', async () => {
    const p = await newPlayer();
    const acc = await account(p.userId);
    const d = await acceptContract(db(), p.userId, (await makeContract('Sofia', 'Plovdiv')).id, (await truckOf(acc.id)).id);
    const token = await trackLink(db(), p.userId, d.id);
    expect(await trackLink(db(), p.userId, d.id)).toBe(token);
    const view = await trackView(db(), token);
    expect(view).toMatchObject({ goods: 'Мебели', status: 'in_progress' });
    expect(view).not.toHaveProperty('payoutCents');
    expect(await trackView(db(), 'nope!')).toBeNull();
  });

  it('an interview once a week; a modest answer adds reputation', async () => {
    const p = await newPlayer();
    const acc = await account(p.userId);
    expect(await db().transaction((tx) => offerInterview(tx, p.userId, 'big_run', new Date()))).toBe(true);
    expect(await db().transaction((tx) => offerInterview(tx, p.userId, 'perfect', new Date()))).toBe(false);
    const open = (await openInterview(db(), p.userId))!;
    await answerInterview(db(), p.userId, open.id, 'modest');
    expect((await account(p.userId)).reputation).toBeCloseTo(acc.reputation + 2);
    const [row] = await db().select().from(interviews).where(eq(interviews.id, open.id));
    expect(row!.answer).toBe('modest');
  });

  it('a driver’s wish: kept by a trip to the city', async () => {
    const p = await newPlayer();
    const acc = await account(p.userId);
    const [d] = await db().insert(drivers).values({ companyId: acc.id, name: 'Иван', skill: 1, salaryCentsPerDay: 100_00, loyalty: 50 }).returning();
    await spawnWishes(db(), new Date(), () => 0);
    const [wish] = await db().select().from(driverWishes).where(eq(driverWishes.driverId, d!.id));
    expect(wish?.status).toBe('open');
    await db().transaction((tx) => recordWishDelivery(tx, p.userId, [d!.id], wish!.cityId, new Date()));
    const [after] = await db().select().from(drivers).where(eq(drivers.id, d!.id));
    expect(after!.loyalty).toBe(60);
  });

  it('the queue can be reordered; a repeated lane starts its next trip', async () => {
    const p = await newPlayer();
    const acc = await account(p.userId);
    const truck = await truckOf(acc.id);
    const first = await makeContract('Sofia', 'Plovdiv');
    await acceptContract(db(), p.userId, first.id, truck.id);
    const a = await makeContract('Plovdiv', 'Sofia');
    const b = await makeContract('Plovdiv', 'Stara Zagora');
    await queueTrip(db(), p.userId, truck.id, a.id);
    const second = await queueTrip(db(), p.userId, truck.id, b.id);
    expect(second.position).toBe(2);
    const list = await queuedTrips(db(), acc.id);
    await moveQueued(db(), p.userId, list[1]!.id, 'up');
    expect((await queuedTrips(db(), acc.id))[0]!.id).toBe(list[1]!.id);
    await db().delete(tripQueue).where(eq(tripQueue.vehicleId, truck.id));
    // Back home: the lane Plovdiv ↔ Sofia.
    await db().update(deliveries).set({ status: 'completed', completedAt: new Date() }).where(eq(deliveries.vehicleId, truck.id));
    await db().update(vehicles).set({ status: 'idle', cityId: a.originCityId, movingUntil: null }).where(eq(vehicles.id, truck.id));
    await setLaneRepeat(db(), p.userId, truck.id, { a: a.originCityId, b: a.destCityId });
    expect(await runLaneRepeats(db())).toBeGreaterThanOrEqual(1);
    const [v] = await db().select().from(vehicles).where(eq(vehicles.id, truck.id));
    expect(v!.status).not.toBe('idle');
    void users;
  });
});

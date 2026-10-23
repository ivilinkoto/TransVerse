import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { canSplit } from '@/lib/game/partial';
import type { RoadEventPlan } from '@/lib/game/road-events';
import { helpableStop, ROADSIDE } from '@/lib/game/roadside';
import type { Segment } from '@/lib/game/schedule';
import { DAILY_LOAD, DUEL, duelWinner, LIVERY_CONTEST, previousMonth, SHARED_LOAD, sofiaMonth } from '@/lib/game/together';
import { closeDb } from '@/server/db/client';
import { coinEntries, companies, contracts, deliveries, duels, friendships, ledgerEntries, liveryEntries, notifications, organizations, sharedLoads, userBadges, vehicles } from '@/server/db/schema';
import { actionButtons } from '@/server/discord/relay';
import { ensureDailyLoad, openContracts } from '@/server/game/contracts';
import { announceConvoy } from '@/server/game/convoy';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { enterLiveryContest, settleLiveryContest, voteLivery } from '@/server/game/livery-contest';
import { joinCompany } from '@/server/game/membership';
import { applyDueRoadEvents } from '@/server/game/road-events';
import { callForHelp, paidRoadHelp } from '@/server/game/roadside';
import { challengeDuel, respondDuel, settleDuels, shareLoad } from '@/server/game/together';
import { approximateProvider } from '@/server/geo/routing';
import { db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const account = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const truck = async (userId: string) => {
  const c = await account(userId);
  const [v] = await db().select().from(vehicles).where(and(eq(vehicles.companyId, c.id), sql`${vehicles.soldAt} is null`));
  return v!.id;
};
/** Accepts and delivers (settled at its arrival); returns the delivery. */
async function haul(userId: string, contractId: string, tons?: number) {
  const d = await acceptContract(db(), userId, contractId, await truck(userId), new Date(), tons ? { tons } : {});
  await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), (await account(userId)).id);
  return d;
}

describe('shared loads', () => {
  it('members take parts; all on time → a bonus on every part and the badge', async () => {
    const owner = await playerWithCompany('Sofia');
    const [org] = await db().select().from(organizations).where(eq(organizations.ownerId, owner.userId));
    await db().update(organizations).set({ recruitment: 'open' }).where(eq(organizations.id, org!.id));
    const member = await newPlayer('Sofia');
    await joinCompany(db(), member.userId, org!.id);
    const stranger = await newPlayer('Sofia');

    const small = await makeContract('Sofia', 'Plovdiv', { weightTons: SHARED_LOAD.minTons - 1 });
    expect(await code(shareLoad(db(), owner.userId, small.id))).toBe('too_small');
    expect(await code(shareLoad(db(), stranger.userId, small.id))).toBe('no_company');

    const job = await makeContract('Sofia', 'Plovdiv', { weightTons: 8, rewardCents: 8_000_00 });
    const shared = await shareLoad(db(), owner.userId, job.id);
    expect(await code(shareLoad(db(), owner.userId, job.id))).toBe('already_shared');
    // Only the members see it and may take it.
    expect((await openContracts(db(), { originCityId: job.originCityId, limit: 300 })).some((c) => c.id === job.id)).toBe(false);
    expect((await openContracts(db(), { originCityId: job.originCityId, limit: 300, memberOfCompanyId: org!.id })).some((c) => c.id === job.id)).toBe(true);
    expect(await code(acceptContract(db(), stranger.userId, job.id, await truck(stranger.userId), new Date(), { tons: 1 }))).toBe('members_only');

    const a = await haul(owner.userId, job.id, 1.3);
    const b = await haul(member.userId, job.id, 1.3);
    // The rest is still on the board: nothing is decided yet.
    expect((await db().select().from(sharedLoads).where(eq(sharedLoads.id, shared.id)))[0]!.status).toBe('open');
    // The last tonnes (here: what others would take) go whole.
    await db().update(contracts).set({ weightTons: 1, rewardCents: 1_000_00 }).where(eq(contracts.id, job.id));
    const c = await haul(owner.userId, job.id);
    expect((await db().select().from(sharedLoads).where(eq(sharedLoads.id, shared.id)))[0]!.status).toBe('done');
    const bonuses = await db().select().from(ledgerEntries).where(eq(ledgerEntries.category, 'shared_load_bonus'));
    const mine = bonuses.filter((e) => [a.id, b.id, c.id].some((id) => e.idempotencyKey === `shared:${shared.id}:${id}`));
    expect(mine.map((e) => e.amountCents).sort((x, y) => x - y)).toEqual([10_000, 13_000, 13_000]);
    const badges = await db().select().from(userBadges).where(and(eq(userBadges.badge, 'team-haul')));
    expect(badges.map((x) => x.userId)).toEqual(expect.arrayContaining([owner.userId, member.userId]));
  });
});

describe('the load of the day', () => {
  it('once a day from 12:00, not split, ТрансКоин when on time', async () => {
    const day = new Date('2027-03-10T09:00:00Z'); // 11:00 in Sofia
    expect(await ensureDailyLoad(db(), day, approximateProvider)).toBeNull();
    const noon = new Date('2027-03-10T10:30:00Z');
    const id = await ensureDailyLoad(db(), noon, approximateProvider);
    expect(id).not.toBeNull();
    expect(await ensureDailyLoad(db(), new Date('2027-03-10T15:00:00Z'), approximateProvider)).toBeNull();
    const [load] = await db().select().from(contracts).where(eq(contracts.id, id!));
    expect(load!.featured).toBe('daily:2027-03-10');
    expect(canSplit(load!)).toBe(false);

    // Delivering one (a small one, so the starter van carries it).
    const p = await newPlayer('Sofia');
    const job = await makeContract('Sofia', 'Plovdiv', { featured: `daily:test-${p.userId}` });
    await haul(p.userId, job.id);
    const [coins] = await db().select().from(coinEntries).where(and(eq(coinEntries.userId, p.userId), eq(coinEntries.reason, 'daily_load')));
    expect(coins!.amount).toBe(DAILY_LOAD.coins);
  });
});

describe('duels', () => {
  it('an invitation, a week of tonnes, the winner gets ТрансКоин and the badge', async () => {
    const a = await newPlayer('Sofia');
    const b = await newPlayer('Sofia');
    expect(await code(challengeDuel(db(), a.userId, a.userId))).toBe('self');
    const d = await challengeDuel(db(), a.userId, b.userId);
    expect(await code(challengeDuel(db(), b.userId, a.userId))).toBe('already');
    expect(await code(respondDuel(db(), a.userId, d.id, true))).toBe('not_found');
    const [invite] = await db().select().from(notifications).where(and(eq(notifications.userId, b.userId), sql`${notifications.href} like '/game/duels?duel=%'`));
    expect(actionButtons(invite!.href, false, new Date()).map((x) => x.custom_id)).toEqual([`duel:yes:${d.id}`, `duel:no:${d.id}`]);
    await respondDuel(db(), b.userId, d.id, true);

    await haul(a.userId, (await makeContract('Sofia', 'Plovdiv', { weightTons: 1.2 })).id);
    const [running] = await db().select().from(duels).where(eq(duels.id, d.id));
    expect(running!.challengerTons).toBeCloseTo(1.2);
    expect(duelWinner(running!)).toBe(a.userId);

    await settleDuels(db(), new Date(running!.endsAt!.getTime() + 1000));
    const [done] = await db().select().from(duels).where(eq(duels.id, d.id));
    expect(done).toMatchObject({ status: 'done', winnerId: a.userId });
    const [coins] = await db().select().from(coinEntries).where(and(eq(coinEntries.userId, a.userId), eq(coinEntries.reason, 'duel')));
    expect(coins!.amount).toBe(DUEL.coins);
    expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, a.userId), eq(userBadges.badge, DUEL.badge)))).toHaveLength(1);
  });
});

describe('livery contest', () => {
  it('one truck a month, 👍 from others, the winner on the 1st', async () => {
    const now = new Date();
    const owner = await newPlayer('Sofia');
    const entry = await enterLiveryContest(db(), owner.userId, await truck(owner.userId), now);
    expect(await code(enterLiveryContest(db(), owner.userId, await truck(owner.userId), now))).toBe('already_entered');
    expect(await code(voteLivery(db(), owner.userId, entry.id, now))).toBe('own');
    for (let i = 0; i < LIVERY_CONTEST.minVotes; i++) {
      const fan = await newPlayer('Sofia');
      expect((await voteLivery(db(), fan.userId, entry.id, now)).votes).toBe(i + 1);
      if (i === 0) expect(await code(voteLivery(db(), fan.userId, entry.id, now))).toBe('already_voted');
    }
    // This month's entries are decided only on the 1st of the next month.
    expect(await settleLiveryContest(db(), now)).toBeNull();
    const [y, m] = sofiaMonth(now).split('-').map(Number) as [number, number];
    const first = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, 9, 30));
    expect(previousMonth(sofiaMonth(first))).toBe(sofiaMonth(now));
    const won = await settleLiveryContest(db(), first);
    expect(won!.id).toBe(entry.id);
    expect(await settleLiveryContest(db(), first)).toBeNull();
    expect((await db().select().from(liveryEntries).where(eq(liveryEntries.id, entry.id)))[0]!.won).toBe(true);
    const [coins] = await db().select().from(coinEntries).where(and(eq(coinEntries.userId, owner.userId), eq(coinEntries.reason, 'livery_contest')));
    expect(coins!.amount).toBe(LIVERY_CONTEST.coins);
  });
});

describe('at a breakdown', () => {
  it('paid assistance saves part of the stop; calling the colleagues asks everyone once', async () => {
    const owner = await newPlayer('Sofia');
    const friend = await newPlayer('Varna');
    await db().insert(friendships).values({ requesterId: owner.userId, addresseeId: friend.userId, status: 'accepted' });
    const d = await acceptContract(db(), owner.userId, (await makeContract('Sofia', 'Plovdiv')).id, await truck(owner.userId));
    const [row] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
    const drive = (row!.schedule as Segment[]).find((s) => s.kind === 'drive' && s.leg === 'loaded')!;
    const at = Math.round((drive.start + drive.end) / 2);
    const events: RoadEventPlan[] = [{ kind: 'breakdown', at, delayMs: 20 * 60_000, costCents: 0, applied: false }];
    await db().update(deliveries).set({ roadEvents: events, nextEventAt: new Date(at) }).where(eq(deliveries.id, d.id));
    await applyDueRoadEvents(db(), new Date(at + 1000));
    const [told] = await db().select().from(notifications).where(and(eq(notifications.userId, owner.userId), sql`${notifications.href} = ${`/game/fleet?stop=${d.id}`}`));
    expect(actionButtons(told!.href, false, new Date()).map((x) => x.custom_id)).toEqual([`road:pay:${d.id}`, `road:call:${d.id}`]);

    const now = new Date(at + 5 * 60_000);
    const [before] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
    const stop = helpableStop(before!.schedule as Segment[], now.getTime())!;
    expect((await callForHelp(db(), owner.userId, d.id, now)).asked).toBe(1);
    expect(await code(callForHelp(db(), owner.userId, d.id, now))).toBe('already_called');
    const [asked] = await db().select().from(notifications).where(and(eq(notifications.userId, friend.userId), sql`${notifications.title} like '%вика помощ%'`));
    expect(asked!.href).toBe(`/game/map?help=${d.id}`);

    const cash = (await account(owner.userId)).balanceCents;
    const r = await paidRoadHelp(db(), owner.userId, d.id, now);
    expect(r.savedMs).toBe(Math.round((stop.end - now.getTime()) * ROADSIDE.paidCut));
    expect((await account(owner.userId)).balanceCents).toBe(cash - ROADSIDE.paidCents);
    // The stop is taken care of now (once per stop).
    expect(await code(paidRoadHelp(db(), owner.userId, d.id, now))).toBe('no_stop');
  });
});

describe('open convoys', () => {
  it('a convoy announced with /конвой takes anyone who leaves on the same lane', async () => {
    const host = await newPlayer('Sofia');
    const stranger = await newPlayer('Sofia');
    expect(await code(announceConvoy(db(), host.userId))).toBe('no_trip');
    // A lane no other test uses: an open convoy takes anyone (from v1.6 up to five trucks).
    const first = await acceptContract(db(), host.userId, (await makeContract('Pleven', 'Ruse')).id, await truck(host.userId));
    const open = await announceConvoy(db(), host.userId);
    expect(open.deliveryId).toBe(first.id);
    expect(await code(announceConvoy(db(), host.userId))).toBe('already');
    const second = await acceptContract(db(), stranger.userId, (await makeContract('Pleven', 'Ruse')).id, await truck(stranger.userId));
    const [row] = await db().select().from(deliveries).where(eq(deliveries.id, second.id));
    expect(row!.convoyWith).toBe(first.id);
  });
});

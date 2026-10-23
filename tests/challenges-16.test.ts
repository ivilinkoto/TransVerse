import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { BIG_CONVOY, bigConvoyShare, challengeMetric, EUROTOUR, WEEKLY_CHALLENGE } from '@/lib/game/challenges';
import { closeDb } from '@/server/db/client';
import { companies, deliveries, jobState, ledgerEntries, userBadges, users, vehicles } from '@/server/db/schema';
import { runCommand } from '@/server/discord/commands';
import { challengeWeek, checkEurotour, eurotourProgress, settleWeeklyChallenge, weeklyChallenge } from '@/server/game/challenges';
import { announceConvoy } from '@/server/game/convoy';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { db, grantLicences, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const truckOf = async (userId: string) => (await db().select().from(vehicles).where(eq(vehicles.companyId, (await accountOf(userId)).id)))[0]!;

describe('rules', () => {
  it('the big convoy pays from three trucks; the measure rotates by week', () => {
    expect(bigConvoyShare(2)).toBe(0);
    expect(bigConvoyShare(3)).toBe(BIG_CONVOY.bonusShare[3]);
    expect(bigConvoyShare(9)).toBe(BIG_CONVOY.bonusShare[5]);
    const weeks = Array.from({ length: WEEKLY_CHALLENGE.rotation.length }, (_, i) => challengeMetric(`W2027-${String(10 + i).padStart(2, '0')}`));
    expect(new Set(weeks).size).toBe(WEEKLY_CHALLENGE.rotation.length);
    expect(challengeMetric('W2027-11')).toBe(challengeMetric('W2027-11'));
    const w = challengeWeek(new Date('2027-03-24T10:00:00Z'));
    expect(w.startsAt.toISOString()).toBe('2027-03-21T22:00:00.000Z'); // Monday 00:00 in Sofia (winter time)
    expect(w.endsAt.toISOString()).toBe('2027-03-28T21:00:00.000Z'); // next Monday, summer time (UTC+3)
  });
});

describe('v1.6 challenges', () => {
  it('Евротур: all nine countries in a month — a badge and ТрансКоин, once', async () => {
    const p = await newPlayer();
    await grantLicences(p.userId, 'international', 'customs');
    const truck = await truckOf(p.userId);
    const first = await makeContract('Sofia', 'Plovdiv');
    const d = await acceptContract(db(), p.userId, first.id, truck.id);
    const [row] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
    // Seven more countries already this month (copies of the trip to other destinations).
    const now = new Date();
    for (const to of ['Bucharest', 'Athens', 'Istanbul', 'Belgrade', 'Skopje', 'Budapest', 'Vienna']) {
      const c = await makeContract('Sofia', to);
      const { id: _id, ...rest } = row!;
      await db().insert(deliveries).values({ ...rest, contractId: c.id, status: 'completed', completedAt: now, late: false });
    }
    // Plovdiv is still on the road: Germany is the ninth.
    const progress = await eurotourProgress(db(), p.userId, now);
    expect(progress.filter((c) => c.done).map((c) => c.code).sort()).toEqual(['AT', 'GR', 'HU', 'MK', 'RO', 'RS', 'TR']);
    expect(await db().transaction((tx) => checkEurotour(tx, p.userId, 'BG', now))).toBe(false);
    const coins0 = (await db().select().from(users).where(eq(users.id, p.userId)))[0]!.coins;
    await db().update(deliveries).set({ status: 'completed', completedAt: now, late: false }).where(eq(deliveries.id, d.id));
    expect(await db().transaction((tx) => checkEurotour(tx, p.userId, 'DE', now))).toBe(true);
    expect(await db().transaction((tx) => checkEurotour(tx, p.userId, 'DE', now))).toBe(false);
    expect((await db().select().from(users).where(eq(users.id, p.userId)))[0]!.coins).toBe(coins0 + EUROTOUR.coins);
    expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, p.userId), eq(userBadges.badge, EUROTOUR.badge)))).toHaveLength(1);
  });

  it('a big convoy: three trucks on an announced lane, a bonus for each, the badge for the first', async () => {
    const [a, b, c] = [await newPlayer(), await newPlayer(), await newPlayer()];
    const trips = [];
    for (const [i, p] of [a, b, c].entries()) {
      // A lane no other test uses: an announced convoy is open to everyone.
      const contract = await makeContract('Plovdiv', 'Varna', { rewardCents: 1_000_00 });
      trips.push(await acceptContract(db(), p.userId, contract.id, (await truckOf(p.userId)).id));
      if (i === 0) await announceConvoy(db(), a.userId);
    }
    const rows = await Promise.all(trips.map(async (t) => (await db().select().from(deliveries).where(eq(deliveries.id, t.id)))[0]!));
    expect(rows.map((r) => r.convoyLead)).toEqual([trips[0]!.id, trips[0]!.id, trips[0]!.id]);
    expect(rows[2]!.convoyWith).toBe(trips[0]!.id);
    for (const [i, p] of [a, b, c].entries()) await settleDueDeliveries(db(), new Date(trips[i]!.etaAt.getTime() + 1000), (await accountOf(p.userId)).id);
    for (const p of [a, b, c]) {
      const big = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, (await accountOf(p.userId)).id), eq(ledgerEntries.description, 'Голям конвой (3 камиона)')));
      expect(big).toHaveLength(1);
    }
    expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, a.userId), eq(userBadges.badge, BIG_CONVOY.badge)))).toHaveLength(1);
    expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, b.userId), eq(userBadges.badge, BIG_CONVOY.badge)))).toHaveLength(0);

    // The challenge of the week counts the on-time trips; /предизвикателство and /конвой-голям answer.
    const week = await weeklyChallenge(db(), trips[0]!.etaAt, a.userId);
    expect(week.mine?.value).toBeGreaterThan(0);
    const linked = `d${Date.now()}`;
    await db().update(users).set({ discordId: linked }).where(eq(users.id, a.userId));
    const reply = await runCommand(db(), { name: 'предизвикателство', options: {}, discordUserId: linked }, trips[0]!.etaAt);
    expect(reply.embeds![0]!.title).toContain(week.title);
    expect((await runCommand(db(), { name: 'конвой-голям', options: {}, discordUserId: linked })).embeds).toHaveLength(1);
  });

  it('the week pays its top three once, some hours after it ends', async () => {
    const next = challengeWeek(new Date(challengeWeek(new Date()).endsAt.getTime() + 3_600_000));
    expect(await settleWeeklyChallenge(db(), new Date(next.startsAt.getTime() + 60_000))).toBeNull();
    const at = new Date(next.startsAt.getTime() + WEEKLY_CHALLENGE.graceMs + 60_000);
    await db().delete(jobState).where(eq(jobState.key, `weekly-challenge:${challengeWeek(new Date()).key}`));
    expect(await settleWeeklyChallenge(db(), at)).not.toBeNull();
    expect(await settleWeeklyChallenge(db(), at)).toBeNull();
  });
});

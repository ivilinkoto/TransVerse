import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { isEquinox, isPassOpening, isSowing, nationalDayToday, PASS_OPENING, SPRING, upcomingNationalDays } from '@/lib/game/spring';
import { buyPriceCents, goodsSeason, sellPriceCents } from '@/lib/game/trade';
import { closeDb } from '@/server/db/client';
import { companies, deliveries, ledgerEntries, passOpenings, userBadges, vehicles } from '@/server/db/schema';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { equinoxWindow } from '@/server/game/spring';
import { db, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;

describe('spring rules', () => {
  it('dates and national days', () => {
    expect(isEquinox(new Date('2027-03-21T10:00:00Z'))).toBe(true);
    expect(isEquinox(new Date('2027-03-24T10:00:00Z'))).toBe(false);
    expect(isPassOpening(new Date('2027-03-16T10:00:00Z'))).toBe(true);
    expect(isSowing(new Date('2027-05-31T10:00:00Z'))).toBe(true);
    expect(nationalDayToday(new Date('2027-03-25T10:00:00Z'), 'GR')?.label).toContain('Гърция');
    expect(nationalDayToday(new Date('2027-03-25T10:00:00Z'), 'BG')).toBeNull();
    expect(upcomingNationalDays(new Date('2027-03-20T10:00:00Z'), 1)[0]!.country).toBe('GR');
    const w = equinoxWindow();
    expect(w.to.getTime() - w.from.getTime()).toBe(4 * 86_400_000);
  });

  it('seasonal goods prices: in season sells for more; producers ask half of that rise', () => {
    const city = { id: 1, countryCode: 'BG' };
    const summer = new Date('2027-07-10T10:00:00Z');
    const winter = new Date('2027-01-10T10:00:00Z');
    expect(goodsSeason('bulk', summer, 'sell')).toBeGreaterThan(goodsSeason('bulk', winter, 'sell'));
    expect(goodsSeason('bulk', summer, 'buy') - 1).toBeCloseTo((goodsSeason('bulk', summer, 'sell') - 1) / 2);
    expect(sellPriceCents(city, 'bulk', 1, summer)).toBeGreaterThan(0);
    expect(buyPriceCents(city, 'bulk', summer)).toBeGreaterThan(0);
  });
});

describe('spring on the road', () => {
  it('the equinox pays a bonus on time; the passes chronicle takes the first ones', async () => {
    const p = await newPlayer();
    const acc = await accountOf(p.userId);
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc.id));
    // Sofia → Ruse stays in Bulgaria (a pass country).
    const c = await makeContract('Sofia', 'Ruse', { expiresAt: new Date('2027-12-31T00:00:00Z') });
    const start = new Date('2027-03-21T08:00:00Z');
    const d = await acceptContract(db(), p.userId, c.id, truck!.id, start);
    await db().update(deliveries).set({ nextEventAt: null }).where(eq(deliveries.id, d.id));
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), acc.id);
    const rows = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, acc.id), eq(ledgerEntries.category, 'holiday_reward')));
    expect(rows.find((r) => r.description.startsWith('Равноденствие'))!.amountCents).toBe(Math.round(c.rewardCents * SPRING.equinoxShare));
    const passed = await db().select().from(passOpenings).where(and(eq(passOpenings.year, 2027), eq(passOpenings.userId, p.userId)));
    if (passed.length) expect(rows.some((r) => r.amountCents === PASS_OPENING.prizeCents)).toBe(true);
    expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, p.userId), like(userBadges.badge, 'spring-%')))).toHaveLength(0);
  });
});

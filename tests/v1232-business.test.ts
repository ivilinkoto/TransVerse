import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { closeDb } from '@/server/db/client';
import { companies, deliveries, users, vehicles } from '@/server/db/schema';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { businessCard, weekStartOf, weeklyEarners } from '@/server/game/business-card';
import { setUiPrefs } from '@/server/game/ui-prefs';
import { adminFullProfile } from '@/server/admin-profile';
import { RELEASES, sectionsFor } from '@/lib/game/releases';
import { releaseAnnouncement } from '@/server/discord/announce';
import { db, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;

/** One real trip, delivered: returns what it paid. */
async function trip(userId: string) {
  const account = await accountOf(userId);
  const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account.id));
  const c = await makeContract('Sofia', 'Plovdiv', { rewardCents: 1_000_00 });
  const d = await acceptContract(db(), userId, c.id, truck!.id);
  await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000));
  const [done] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
  return { cents: Number(done!.payoutCents), at: done!.completedAt! };
}

describe('1.2.3.2 „Бизнес профил“', () => {
  it('the week starts on Monday (Sofia)', () => {
    const start = weekStartOf(new Date('2026-11-06T15:00:00Z')); // a Friday
    expect(start.toISOString()).toBe('2026-11-01T22:00:00.000Z'); // Monday 00:00 in Sofia (UTC+2)
  });

  it('a card with trip income and fleet; hidden players stay out of the ranking', async () => {
    const p = await newPlayer();
    const now = new Date();
    const card0 = (await businessCard(db(), p.userId, now))!;
    expect(card0.hidden).toBe(false);
    expect(card0.week.cents).toBe(0);
    expect(card0.trucks).toBeGreaterThanOrEqual(1); // the starter rental
    const paid = await trip(p.userId);
    expect(paid.cents).toBeGreaterThan(0);
    const later = new Date(paid.at.getTime() + 1000);
    const card = (await businessCard(db(), p.userId, later))!;
    expect(card.total.trips).toBe(1);
    expect(card.total.cents).toBe(paid.cents);
    if (weekStartOf(later) <= paid.at) {
      expect(card.week.cents).toBe(paid.cents);
      expect((await weeklyEarners(db(), later, 100)).some((r) => r.userId === p.userId && r.cents === paid.cents)).toBe(true);
    }
    await setUiPrefs(db(), p.userId, { hideBusiness: true });
    expect((await businessCard(db(), p.userId, now))!.hidden).toBe(true);
    expect((await weeklyEarners(db(), later, 100)).some((r) => r.userId === p.userId)).toBe(false);
    const [u] = await db().select({ prefs: users.uiPrefs }).from(users).where(eq(users.id, p.userId));
    expect(u!.prefs.hideBusiness).toBe(true);
  });

  it('the full profile for the team ignores „Скрий“; payments only for administrators', async () => {
    const p = await newPlayer();
    await setUiPrefs(db(), p.userId, { hideBusiness: true });
    const forSupport = (await adminFullProfile(db(), p.userId, new Date(), false))!;
    expect(forSupport.business?.hidden).toBe(true);
    expect(forSupport.business?.week.cents).toBe(0);
    expect(forSupport.payments).toBeNull();
    expect((await adminFullProfile(db(), p.userId, new Date(), true))!.payments).toEqual({ cents: 0, count: 0 });
  });

  it('release notes for the team are for the staff only', () => {
    const r = RELEASES.find((x) => x.version === '1.2.3.2')!;
    expect(sectionsFor(r, true).some((s) => s.title === 'За екипа')).toBe(true);
    expect(sectionsFor(r, false).some((s) => s.title === 'За екипа')).toBe(false);
    const old = RELEASES.find((x) => x.version === '1.2.3.1')!;
    expect(sectionsFor(old, false).some((s) => s.title === 'Админ панел')).toBe(false);
    expect(JSON.stringify(releaseAnnouncement(r))).not.toContain('Пълна информация');
  });
});

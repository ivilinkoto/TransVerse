import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { companyMissionTarget, COMPANY_MISSIONS, pickCompanyMissions } from '@/lib/game/company-missions';
import { autoTarget, DEFAULT_REWARDS, EVENT_METRIC_INFO, eventIncrement, EVENT_TEMPLATES, nextAutoWindow, pickTemplate, rewardFor } from '@/lib/game/events';
import type { DeliveryFacts } from '@/lib/game/missions';
import { isVip } from '@/lib/game/vip';
import { closeDb } from '@/server/db/client';
import { coinEntries, companies, companyMembers, companyMissionProgress, globalEventContributions, globalEvents, ledgerEntries, notifications, treasuryEntries, users, vehicles } from '@/server/db/schema';
import { companyMissionBoard, ensureCompanyMissions } from '@/server/game/company-missions';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { cancelEvent, createEvent, ensureAutoEvent, eventsBoard, settleDueEvents } from '@/server/game/events';
import { db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(async () => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const truckOf = async (companyId: string) => (await db().select().from(vehicles).where(and(eq(vehicles.companyId, companyId), sql`${vehicles.soldAt} is null`)))[0]!;
const staff = async (role: 'admin' | 'support') => {
  const p = await newPlayer();
  await db().update(users).set({ role }).where(eq(users.id, p.userId));
  return { id: p.userId, role, username: p.username };
};

/** One delivery from `from` to `to`, settled right after arrival. Returns the arrival time. */
async function deliver(userId: string, from: string, to: string, overrides: Parameters<typeof makeContract>[2] = {}) {
  const contract = await makeContract(from, to, overrides);
  const account = await accountOf(userId);
  const d = await acceptContract(db(), userId, contract.id, (await truckOf(account.id)).id);
  // Only this player's trip: deliveries other test files left on the road must not count in the event.
  await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), account.id);
  return d.etaAt;
}

const facts = (over: Partial<DeliveryFacts> = {}): DeliveryFacts => ({ loadedKm: 400, tons: 12, onTime: true, rewardCents: 900_00, cargoType: 'pallets', countries: ['BG'], urgent: false, inCompany: false, ...over });
const eventInput = (over: Record<string, unknown> = {}) => ({
  name: 'Тестов ивент',
  description: '',
  metric: 'deliveries' as const,
  cargoType: null,
  countryCode: null,
  target: 3,
  minContribution: 1,
  durationHours: 48,
  participant: { eur: 1000, xp: 100, coins: 5 },
  top: [{ eur: 5000, xp: 500, coins: 50, vipDays: 3 }],
  announce: false,
  ...over,
});

describe('event rules', () => {
  it('counts only matching deliveries', () => {
    expect(eventIncrement({ metric: 'tons', cargoType: null, countryCode: null }, facts())).toBe(12);
    expect(eventIncrement({ metric: 'tons', cargoType: 'refrigerated', countryCode: null }, facts())).toBe(0);
    expect(eventIncrement({ metric: 'deliveries', cargoType: null, countryCode: 'GR' }, facts())).toBe(0);
    expect(eventIncrement({ metric: 'deliveries', cargoType: null, countryCode: 'GR' }, facts({ countries: ['BG', 'GR'] }))).toBe(1);
    expect(eventIncrement({ metric: 'international', cargoType: null, countryCode: null }, facts())).toBe(0);
    expect(eventIncrement({ metric: 'on_time', cargoType: null, countryCode: null }, facts({ onTime: false }))).toBe(0);
    expect(eventIncrement({ metric: 'earned_cents', cargoType: null, countryCode: null }, facts())).toBe(900_00);
  });

  it('schedules automatic events at 18:00 Bulgarian time after a pause, never the same twice in a row', () => {
    const now = new Date('2026-10-16T10:00:00Z');
    expect(nextAutoWindow(null, now).startsAt).toEqual(now);
    const next = nextAutoWindow(new Date('2026-10-16T15:00:00Z'), now);
    // End 15:00 UTC + 20 h pause = 17 Oct 11:00 UTC → 17 Oct 18:00 Sofia (15:00 UTC, summer time).
    expect(next.startsAt.toISOString()).toBe('2026-10-17T15:00:00.000Z');
    expect(next.endsAt.getTime() - next.startsAt.getTime()).toBe(72 * 3_600_000);
    for (const t of EVENT_TEMPLATES) expect(pickTemplate(next.startsAt, t.id).id).not.toBe(t.id);
    expect(new Set(EVENT_TEMPLATES.map((t) => t.name)).size).toBe(EVENT_TEMPLATES.length);
  });

  it('sizes automatic targets by recent activity with a floor', () => {
    expect(autoTarget('tons', 0, 168, 72)).toBe(EVENT_METRIC_INFO.tons.floor);
    // 7 000 t in a week → 3 000 t in 72 h, +15 % → 3 450 → 3 500.
    expect(autoTarget('tons', 7_000, 168, 72)).toBe(3_500);
  });

  it('adds the place bonus to the participant reward', () => {
    expect(rewardFor(DEFAULT_REWARDS, null)).toEqual({ ...DEFAULT_REWARDS.participant, vipDays: 0 });
    const first = rewardFor(DEFAULT_REWARDS, 1);
    expect(first.vipDays).toBe(7);
    expect(first.cents).toBe(DEFAULT_REWARDS.participant.cents + DEFAULT_REWARDS.top[0]!.cents);
    expect(rewardFor(DEFAULT_REWARDS, 99).vipDays).toBe(0);
  });
});

describe('global events', () => {
  it('everyone contributes; when the goal is reached participants and the best are rewarded once', async () => {
    const admin = await staff('admin');
    const support = await staff('support');
    expect(await code(createEvent(db(), support, eventInput()))).toBe('forbidden');
    const event = await createEvent(db(), admin, eventInput());
    const [a, b] = [await newPlayer('Sofia'), await newPlayer('Sofia')];

    await deliver(a.userId, 'Sofia', 'Plovdiv');
    await deliver(b.userId, 'Sofia', 'Plovdiv');
    let [e] = await db().select().from(globalEvents).where(eq(globalEvents.id, event.id));
    expect(e!.progress).toBe(2);
    expect(e!.completedAt).toBeNull();
    await deliver(a.userId, 'Plovdiv', 'Sofia');
    [e] = await db().select().from(globalEvents).where(eq(globalEvents.id, event.id));
    expect(e!.progress).toBe(3);
    expect(e!.completedAt).not.toBeNull();

    // Contributions after the goal was reached no longer count.
    await deliver(b.userId, 'Plovdiv', 'Sofia');
    [e] = await db().select().from(globalEvents).where(eq(globalEvents.id, event.id));
    expect(e!.progress).toBe(3);

    const board = await eventsBoard(db(), a.userId, new Date());
    const shown = board.open.find((d) => d.event.id === event.id)!;
    expect(shown.mine).toMatchObject({ amount: 2, rank: 1 });
    expect(shown.leaders[0]!.userId).toBe(a.userId);

    const later = new Date(Date.now() + 3 * 86_400_000);
    await settleDueDeliveries(db(), later);
    expect(await settleDueEvents(db(), later)).toBeGreaterThanOrEqual(1);
    [e] = await db().select().from(globalEvents).where(eq(globalEvents.id, event.id));
    expect(e!.outcome).toBe('success');

    const rows = await db().select().from(globalEventContributions).where(eq(globalEventContributions.eventId, event.id));
    const ra = rows.find((r) => r.userId === a.userId)!;
    const rb = rows.find((r) => r.userId === b.userId)!;
    expect([ra.rank, rb.rank]).toEqual([1, 2]);
    expect(ra.reward).toMatchObject({ cents: 6000_00, coins: 55, vipDays: 3 });
    expect(rb.reward).toMatchObject({ cents: 1000_00, coins: 5, vipDays: 0 });
    const [ua] = await db().select().from(users).where(eq(users.id, a.userId));
    expect(isVip(ua!.vipUntil, later)).toBe(true);
    // Only this event's coins (other events in the shared test database may pay too).
    const coins = await db().select().from(coinEntries).where(and(eq(coinEntries.userId, a.userId), sql`${coinEntries.idempotencyKey} like ${'%' + event.id + '%'}`));
    expect(coins.reduce((s, c) => s + c.amount, 0)).toBe(55);

    // Settling again changes nothing.
    await settleDueEvents(db(), later);
    const paid = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.category, 'event_reward'), eq(ledgerEntries.refId, event.id)));
    expect(paid).toHaveLength(2);
    const [note] = await db().select().from(notifications).where(and(eq(notifications.userId, b.userId), sql`${notifications.title} like 'Ивентът%успешен%'`));
    expect(note).toBeDefined();
  });

  it('a missed goal rewards nobody; administrators can cancel an event', async () => {
    const admin = await staff('admin');
    const event = await createEvent(db(), admin, eventInput({ target: 1_000_000, durationHours: 6 }));
    const p = await newPlayer('Sofia');
    await deliver(p.userId, 'Sofia', 'Plovdiv');
    const after = new Date(Date.now() + 7 * 3_600_000);
    await settleDueDeliveries(db(), after);
    await settleDueEvents(db(), after);
    const [e] = await db().select().from(globalEvents).where(eq(globalEvents.id, event.id));
    expect(e!.outcome).toBe('failed');
    const [c] = await db().select().from(globalEventContributions).where(and(eq(globalEventContributions.eventId, event.id), eq(globalEventContributions.userId, p.userId)));
    expect(c!.reward).toBeNull();
    expect(await db().select().from(ledgerEntries).where(eq(ledgerEntries.refId, event.id))).toHaveLength(0);

    const other = await createEvent(db(), admin, eventInput({ name: 'За отмяна' }));
    await cancelEvent(db(), admin, other.id);
    expect(await code(cancelEvent(db(), admin, other.id))).toBe('event_settled');
    const [x] = await db().select().from(globalEvents).where(eq(globalEvents.id, other.id));
    expect(x!.outcome).toBe('cancelled');
  });

  it('keeps an automatic event announced and does not stack them', async () => {
    const far = new Date(Date.now() + 500 * 86_400_000);
    const created = await ensureAutoEvent(db(), far);
    expect(created).not.toBeNull();
    expect(created!.template).toBeTruthy();
    expect(created!.startsAt.getTime()).toBeGreaterThanOrEqual(far.getTime());
    expect(created!.target).toBeGreaterThanOrEqual(EVENT_METRIC_INFO[created!.metric as keyof typeof EVENT_METRIC_INFO].floor);
    expect(await ensureAutoEvent(db(), far)).toBeNull();
    const p = await newPlayer();
    expect(p).toBeDefined();
  });
});

describe('company missions', () => {
  it('rules scale with the team', () => {
    const solo = pickCompanyMissions('x:W1', 1);
    expect(solo).toHaveLength(3);
    expect(solo.some((m) => m.metric === 'active_members')).toBe(false);
    const km = COMPANY_MISSIONS.find((m) => m.id === 'c_km')!;
    expect(companyMissionTarget(km, 10)).toBeGreaterThan(companyMissionTarget(km, 1));
  });

  it('members complete weekly goals and the reward goes to the treasury once', async () => {
    const owner = await playerWithCompany();
    const [m] = await db().select().from(companyMembers).where(eq(companyMembers.userId, owner.userId));
    const now = new Date();
    await ensureCompanyMissions(db(), m!.companyId, now);
    const rows = await db().select().from(companyMissionProgress).where(eq(companyMissionProgress.companyId, m!.companyId));
    expect(rows).toHaveLength(3);
    await db().update(companyMissionProgress).set({ target: 1 }).where(eq(companyMissionProgress.companyId, m!.companyId));

    await deliver(owner.userId, 'Sofia', 'Plovdiv');
    const after = await db().select().from(companyMissionProgress).where(eq(companyMissionProgress.companyId, m!.companyId));
    const done = after.filter((r) => r.completedAt);
    expect(done.length).toBeGreaterThan(0);
    const paid = await db().select().from(treasuryEntries).where(and(eq(treasuryEntries.organizationId, m!.companyId), eq(treasuryEntries.category, 'company_mission')));
    expect(paid).toHaveLength(done.length);
    expect(paid.reduce((s, r) => s + r.amountCents, 0)).toBe(done.reduce((s, r) => s + r.rewardCents, 0));

    const board = await companyMissionBoard(db(), m!.companyId, now);
    const shown = board.missions.find((r) => r.completedAt)!;
    expect(shown.contributors[0]!.username).toBe(owner.username);
  });
});

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { gameDurationMinutes } from '@/lib/game/schedule';
import { adjustBalance, bootstrapFounder, setBan, setUserRole } from '@/server/admin';
import { authenticate } from '@/server/auth/accounts';
import { canBan, canChangeRole } from '@/server/auth/roles';
import { createSession, validateSession } from '@/server/auth/session';
import { closeDb } from '@/server/db/client';
import { adminAudit, companies, deliveries, depots, ledgerEntries, notifications, users, vehicles } from '@/server/db/schema';
import { foundCompany, rentVehicle, returnRental } from '@/server/game/company';
import { acceptContract, migrateToGameTime, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { createTicket, replyToTicket, ticketThread } from '@/server/game/support';
import { completeTutorialStep, tutorialState } from '@/server/game/tutorial';
import { db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(async () => closeDb());

const companyOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const fleetOf = async (companyId: string) => db().select().from(vehicles).where(and(eq(vehicles.companyId, companyId), sql`${vehicles.soldAt} is null`));
const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const roleOf = async (userId: string) => (await db().select({ role: users.role, username: users.username, id: users.id }).from(users).where(eq(users.id, userId)))[0]!;

describe('company founding', () => {
  it('enforces level, deliveries and the fee, then creates the company with an HQ depot', async () => {
    const p = await newPlayer();
    expect(await code(foundCompany(db(), p.userId, { name: 'Ранна Фирма', hqCityId: p.hq.id }))).toBe('founding_level');
    await db().update(users).set({ level: 2 }).where(eq(users.id, p.userId));
    expect(await code(foundCompany(db(), p.userId, { name: 'Ранна Фирма', hqCityId: p.hq.id }))).toBe('founding_deliveries');
    const c = await companyOf(p.userId);
    await db().update(companies).set({ deliveries: 3 }).where(eq(companies.id, c.id));
    expect(await code(foundCompany(db(), p.userId, { name: 'Ранна Фирма', hqCityId: p.hq.id }))).toBe('insufficient_funds');

    const founded = await playerWithCompany('Varna');
    const company = await companyOf(founded.userId);
    expect(company.kind).toBe('company');
    expect(company.name).toContain('Тест');
    expect(company.foundedAt).not.toBeNull();
    const [depot] = await db().select().from(depots).where(eq(depots.companyId, company.id));
    expect(depot?.cityId).toBe(founded.hq.id);
    const fee = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, company.id), eq(ledgerEntries.category, 'company_founding')));
    expect(fee).toHaveLength(1);
    expect(fee[0]!.amountCents).toBe(-5_000_00);
    expect(await code(foundCompany(db(), founded.userId, { name: 'Втора', hqCityId: founded.hq.id }))).toBe('already_founded');
  });
});

describe('rentals', () => {
  it('companies can rent more trucks; the last truck of an independent cannot be returned', async () => {
    const solo = await newPlayer();
    expect(await code(rentVehicle(db(), solo.userId, 'rent-van', solo.hq.id))).toBe('company_required');
    const [starter] = await fleetOf((await companyOf(solo.userId)).id);
    expect(await code(returnRental(db(), solo.userId, starter!.id))).toBe('last_vehicle');

    const p = await playerWithCompany();
    const company = await companyOf(p.userId);
    const rented = await rentVehicle(db(), p.userId, 'rent-van', p.hq.id);
    expect(rented.ownership).toBe('rented');
    expect((await fleetOf(company.id)).length).toBe(2);
    await returnRental(db(), p.userId, rented.id);
    expect((await fleetOf(company.id)).length).toBe(1);
  });
});

describe('game time', () => {
  it('deliveries take hours, not days', async () => {
    const p = await newPlayer();
    const [truck] = await fleetOf((await companyOf(p.userId)).id);
    const contract = await makeContract('Sofia', 'Thessaloníki');
    const d = await acceptContract(db(), p.userId, contract.id, truck!.id);
    const minutes = (d.etaAt.getTime() - d.startedAt.getTime()) / 60_000;
    expect(minutes).toBeCloseTo(gameDurationMinutes(d.emptyKm + d.loadedKm), 0);
    expect(minutes).toBeLessThanOrEqual(60);
    expect(d.scheduleVersion).toBe(4);
  });

  it('rescales deliveries from older game-time rules once', async () => {
    const p = await newPlayer();
    const [truck] = await fleetOf((await companyOf(p.userId)).id);
    const contract = await makeContract('Sofia', 'Varna');
    const d = await acceptContract(db(), p.userId, contract.id, truck!.id);
    // Simulate an old delivery: version 1 and a 3-day ETA.
    const longEta = new Date(d.startedAt.getTime() + 3 * 86_400_000);
    await db().update(deliveries).set({ scheduleVersion: 1, etaAt: longEta }).where(eq(deliveries.id, d.id));
    expect(await migrateToGameTime(db())).toBeGreaterThanOrEqual(1);
    const [after] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
    expect(after!.scheduleVersion).toBe(4);
    expect((after!.etaAt.getTime() - after!.startedAt.getTime()) / 60_000).toBeCloseTo(gameDurationMinutes(after!.emptyKm + after!.loadedKm), 0);
    expect(after!.etaAt.getTime()).toBeLessThan(longEta.getTime());
    expect(await migrateToGameTime(db())).toBe(0);
  });
});

describe('tutorial', () => {
  it('advances from real actions and rewards once at the end', async () => {
    const p = await newPlayer();
    const company = await companyOf(p.userId);
    expect((await tutorialState(db(), p.userId)).step?.key).toBe('welcome');
    await completeTutorialStep(db(), p.userId, 'welcome');
    expect((await tutorialState(db(), p.userId)).step?.key).toBe('first_contract');
    expect(await code(completeTutorialStep(db(), p.userId, 'first_contract'))).toBe('auto_step');

    const [truck] = await fleetOf(company.id);
    const d = await acceptContract(db(), p.userId, (await makeContract('Sofia', 'Pernik')).id, truck!.id);
    expect((await tutorialState(db(), p.userId)).step?.key).toBe('track_map');
    await completeTutorialStep(db(), p.userId, 'track_map');
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), company.id);
    expect((await tutorialState(db(), p.userId)).step?.key).toBe('finances');
    await completeTutorialStep(db(), p.userId, 'finances');
    await completeTutorialStep(db(), p.userId, 'company_goal');
    const done = await tutorialState(db(), p.userId);
    expect(done.active).toBe(false);
    await tutorialState(db(), p.userId);
    const rewards = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, company.id), eq(ledgerEntries.category, 'tutorial_reward')));
    expect(rewards).toHaveLength(1);
  });
});

describe('support and administration', () => {
  it('players open tickets, staff answer, others cannot read them', async () => {
    const player = await newPlayer();
    const other = await newPlayer();
    const staff = await newPlayer();
    await db().update(users).set({ role: 'support' }).where(eq(users.id, staff.userId));
    const p = await roleOf(player.userId);
    const s = await roleOf(staff.userId);
    const o = await roleOf(other.userId);

    const ticket = await createTicket(db(), p, { subject: 'Камионът не тръгва', category: 'bug', body: 'Натискам приеми, но нищо не става.' });
    expect(await code(ticketThread(db(), o, ticket.id))).toBe('ticket_not_found');
    const staffNotes = await db().select().from(notifications).where(eq(notifications.userId, staff.userId));
    expect(staffNotes.some((n) => n.title.includes('Камионът не тръгва'))).toBe(true);

    await replyToTicket(db(), s, ticket.id, 'Здравейте! Проверете дали има назначен шофьор.');
    const thread = await ticketThread(db(), p, ticket.id);
    expect(thread.ticket.status).toBe('answered');
    expect(thread.messages.map((m) => m.staff)).toEqual([false, true]);
    const playerNotes = await db().select().from(notifications).where(eq(notifications.userId, player.userId));
    expect(playerNotes.some((n) => n.title.startsWith('Отговор от поддръжката'))).toBe(true);
  });

  it('applies the role hierarchy', async () => {
    expect(canChangeRole('founder', 'a', 'player', 'b', 'admin')).toBe(true);
    expect(canChangeRole('admin', 'a', 'player', 'b', 'support')).toBe(true);
    expect(canChangeRole('admin', 'a', 'player', 'b', 'admin')).toBe(false);
    expect(canChangeRole('admin', 'a', 'admin', 'b', 'player')).toBe(false);
    expect(canChangeRole('support', 'a', 'player', 'b', 'support')).toBe(false);
    expect(canChangeRole('founder', 'a', 'founder', 'b', 'player')).toBe(false);
    expect(canChangeRole('founder', 'a', 'player', 'a', 'admin')).toBe(false);
    expect(canBan('admin', 'a', 'support', 'b')).toBe(true);
    expect(canBan('admin', 'a', 'admin', 'b')).toBe(false);
    expect(canBan('founder', 'a', 'founder', 'b')).toBe(false);
  });

  it('bootstraps the founder, who can appoint admins; bans block login; balance corrections are audited', async () => {
    const founderPlayer = await newPlayer();
    expect(await bootstrapFounder(db(), founderPlayer.username.toUpperCase())).toBe('promoted');
    expect(await bootstrapFounder(db(), founderPlayer.username)).toBe('already');
    expect(await bootstrapFounder(db(), 'няма-такъв')).toBe('missing');
    const founder = await roleOf(founderPlayer.userId);
    expect(founder.role).toBe('founder');

    const a = await newPlayer();
    await setUserRole(db(), founder, a.userId, 'admin');
    const admin = await roleOf(a.userId);
    expect(admin.role).toBe('admin');

    const victim = await newPlayer();
    expect(await code(setUserRole(db(), admin, victim.userId, 'admin'))).toBe('forbidden');
    await setUserRole(db(), admin, victim.userId, 'support');
    expect(await code(setUserRole(db(), admin, founderPlayer.userId, 'player'))).toBe('forbidden');

    const { token } = await createSession(db(), victim.userId);
    await setBan(db(), admin, victim.userId, true, 'спам');
    expect(await validateSession(db(), token)).toBeNull();
    expect(await code(authenticate(db(), { login: victim.username, password: 'correct horse battery' }))).toBe('banned');
    await setBan(db(), admin, victim.userId, false, '');
    expect(await authenticate(db(), { login: victim.username, password: 'correct horse battery' })).toBe(victim.userId);

    const supportActor = await roleOf(victim.userId);
    expect(await code(adjustBalance(db(), supportActor, a.userId, 100_00, 'опит без права'))).toBe('forbidden');
    const before = (await companyOf(victim.userId)).balanceCents;
    await adjustBalance(db(), admin, victim.userId, 250_00, 'компенсация за грешка');
    expect((await companyOf(victim.userId)).balanceCents).toBe(before + 250_00);
    const audit = await db().select().from(adminAudit).where(and(eq(adminAudit.targetUserId, victim.userId), eq(adminAudit.action, 'adjust_balance')));
    expect(audit).toHaveLength(1);
  });
});

describe('audit log wording', () => {
  it('describes administrative actions in Bulgarian', async () => {
    const { describeAudit } = await import('@/server/audit-format');
    expect(describeAudit({ action: 'set_role', details: { from: 'player', to: 'support' } }, 'ANGELov', 'vesichaa')).toBe('Смени длъжността на vesichaa: Играч → Техническа поддръжка');
    expect(describeAudit({ action: 'replenish_market', details: { created: 12 } }, 'ANGELov', null)).toBe('Попълни товарния пазар ръчно (12 нови поръчки)');
    expect(describeAudit({ action: 'bootstrap_founder', details: {} }, 'ANGELov', 'ANGELov')).toContain('Основател');
    expect(describeAudit({ action: 'adjust_balance', details: { amountCents: 25000, reason: 'компенсация' } }, 'a', 'b')).toContain('+250,00');
  });
});

describe('player feedback fixes', () => {
  it('accepts a 6-character password and rejects 5', async () => {
    const { registerSchema } = await import('@/server/auth/accounts');
    const base = { email: 'six@example.com', username: 'six_chars', startCityId: 1 };
    expect(registerSchema.safeParse({ ...base, password: '123456' }).success).toBe(true);
    expect(registerSchema.safeParse({ ...base, password: '12345' }).success).toBe(false);
  });

  it('always offers a doable job in the city where the free truck stands', async () => {
    const { ensureLocalJobsForFleet } = await import('@/server/game/contracts');
    const { approximateProvider } = await import('@/server/geo/routing');
    const { cityByName } = await import('./helpers');
    const { contracts } = await import('@/server/db/schema');
    const p = await newPlayer();
    const company = await companyOf(p.userId);
    const [truck] = await fleetOf(company.id);
    // Park the truck in a small town with no open contracts at all.
    const town = await cityByName('Vidin');
    await db().update(contracts).set({ status: 'expired' }).where(and(eq(contracts.originCityId, town.id), eq(contracts.status, 'open')));
    await db().update(vehicles).set({ cityId: town.id }).where(eq(vehicles.id, truck!.id));

    expect(await ensureLocalJobsForFleet(db(), new Date(), company.id, approximateProvider)).toBe(1);
    const local = await db().select().from(contracts).where(and(eq(contracts.originCityId, town.id), eq(contracts.status, 'open')));
    expect(local).toHaveLength(1);
    expect(local[0]!.weightTons).toBeLessThanOrEqual(7.5);
    expect(local[0]!.cargoType).toBe('pallets');
    // Idempotent while the job is still there.
    expect(await ensureLocalJobsForFleet(db(), new Date(), company.id, approximateProvider)).toBe(0);
    // And the truck can really take it.
    const d = await acceptContract(db(), p.userId, local[0]!.id, truck!.id);
    expect(d.status).toBe('in_progress');
  });
});

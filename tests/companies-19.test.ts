import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { ASSEMBLY, isTraditionDay, keyClientName } from '@/lib/game/company-life';
import { closeDb } from '@/server/db/client';
import { companies, companyAssemblies, companyChronicle, companyMembers, companyOwners, contracts, deliveries, keyClients, ledgerEntries, mergerOffers, organizations, vehicles } from '@/server/db/schema';
import {
  acceptMerger, closeAssemblies, companyHistory, createDepartment, decideInternship, departmentsView, internDelivery, joinDepartment, openAssembly, proposeMerger, requestInternship, setLogoDesign, setTradition, traditionBonus, voteAssembly, awardKeyClients,
} from '@/server/game/company-life';
import { acceptContract } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { postTreasury } from '@/server/game/finance';
import { joinCompany, transferOwnership } from '@/server/game/membership';
import { db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const orgOf = async (userId: string) => (await db().select().from(organizations).where(eq(organizations.ownerId, userId)))[0]!;
const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const open = async (orgId: string) => db().update(organizations).set({ recruitment: 'open', minJoinLevel: 1 }).where(eq(organizations.id, orgId));
const member = async (orgId: string) => {
  const p = await newPlayer();
  await joinCompany(db(), p.userId, orgId);
  return p;
};

describe('v1.9 company life', () => {
  it('departments: a manager makes one, members pick it, the view counts them', async () => {
    const owner = await playerWithCompany();
    const org = await orgOf(owner.userId);
    await open(org.id);
    const m = await member(org.id);
    const { id } = await createDepartment(db(), owner.userId, { name: 'Север', goalTons: 100 });
    expect(await code(createDepartment(db(), m.userId, { name: 'Юг' }))).toBe('forbidden');
    await joinDepartment(db(), m.userId, id);
    const view = await departmentsView(db(), org.id);
    expect(view.find((d) => d.id === id)?.members.length).toBe(1);
  });

  it('the general assembly on the rate: votes, closes on time and sets the contribution', async () => {
    const owner = await playerWithCompany();
    const org = await orgOf(owner.userId);
    await open(org.id);
    const a = await member(org.id);
    const b = await member(org.id);
    const now = new Date();
    const { id } = await openAssembly(db(), owner.userId, { question: 'колко да е?', kind: 'rate' }, now);
    expect(await code(openAssembly(db(), owner.userId, { question: 'още едно?', kind: 'rate' }, now))).toBe('already_open');
    const ten = ASSEMBLY.rateOptions.indexOf(0.1);
    await voteAssembly(db(), a.userId, id, ten, now);
    await voteAssembly(db(), b.userId, id, ten, now);
    await voteAssembly(db(), owner.userId, id, 0, now);
    expect(await code(voteAssembly(db(), a.userId, id, 0, now))).toBe('already_voted');
    await closeAssemblies(db(), new Date(now.getTime() + (ASSEMBLY.days + 1) * 86_400_000));
    const [after] = await db().select().from(organizations).where(eq(organizations.id, org.id));
    expect(after!.contributionRate).toBeCloseTo(0.1);
    const [row] = await db().select().from(companyAssemblies).where(eq(companyAssemblies.id, id));
    expect(row!.result).toBe(ten);
    const chronicle = await db().select().from(companyChronicle).where(and(eq(companyChronicle.organizationId, org.id), eq(companyChronicle.kind, 'assembly')));
    expect(chronicle.length).toBe(1);
  });

  it('key client: last month’s top company in a big city gets it once', async () => {
    const owner = await playerWithCompany();
    const org = await orgOf(owner.userId);
    const acc = await accountOf(owner.userId);
    // A month far ahead so no other test run has awarded it yet.
    const year = 2200 + Math.floor(Math.random() * 700);
    const now = new Date(`${year}-05-03T12:00:00Z`);
    const c = await makeContract('Plovdiv', 'Sofia');
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc.id));
    const d = await acceptContract(db(), owner.userId, c.id, truck!.id);
    await db().update(deliveries).set({ status: 'completed', completedAt: new Date(`${year}-04-10T10:00:00Z`) }).where(eq(deliveries.id, d.id));
    await db().update(contracts).set({ weightTons: 60 }).where(eq(contracts.id, c.id));
    expect(await awardKeyClients(db(), now)).toBeGreaterThanOrEqual(1);
    const [k] = await db().select().from(keyClients).where(and(eq(keyClients.organizationId, org.id), eq(keyClients.month, `${year}-05`)));
    expect(k?.client).toBe(keyClientName('София', c.destCityId));
    expect(await awardKeyClients(db(), now)).toBe(0);
  });

  it('logo and tradition day: the design is saved, the day pays +5 %', async () => {
    const owner = await playerWithCompany();
    const org = await orgOf(owner.userId);
    await setLogoDesign(db(), owner.userId, { shape: 'shield', color: '#22d3ee', accent: '#facc15', initials: 'ТВ' } as never);
    const [withLogo] = await db().select().from(organizations).where(eq(organizations.id, org.id));
    expect(withLogo!.logoDesign).toMatchObject({ initials: 'ТВ' });
    const at = new Date('2027-07-15T09:00:00Z');
    await setTradition(db(), owner.userId, { day: '07-15', name: 'Ден на шофьора' });
    expect(isTraditionDay('07-15', '07-15')).toBe(true);
    const acc = await accountOf(owner.userId);
    const bonus = await db().transaction((tx) => traditionBonus(tx, owner.userId, { id: crypto.randomUUID(), companyId: acc.id }, 1_000_00, at));
    expect(bonus).toBe(50_00);
    expect(await db().transaction((tx) => traditionBonus(tx, owner.userId, { id: crypto.randomUUID(), companyId: acc.id }, 1_000_00, new Date('2027-07-16T09:00:00Z')))).toBe(0);
    const entries = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, acc.id), eq(ledgerEntries.category, 'company_bonus')));
    expect(entries.length).toBe(1);
  });

  it('an intern: asks, is accepted, drives with extra XP; one stay at a time', async () => {
    const owner = await playerWithCompany();
    const host = await orgOf(owner.userId);
    const intern = await newPlayer();
    const { id } = await requestInternship(db(), intern.userId, host.id);
    expect(await code(requestInternship(db(), intern.userId, host.id))).toBe('busy');
    await decideInternship(db(), owner.userId, id, true);
    const extra = await db().transaction((tx) => internDelivery(tx, intern.userId, 100, new Date()));
    expect(extra).toBe(10);
  });

  it('a merger: the small company moves in as a department with its treasury; the dynasty remembers owners', async () => {
    const bigOwner = await playerWithCompany();
    const big = await orgOf(bigOwner.userId);
    const smallOwner = await playerWithCompany();
    const small = await orgOf(smallOwner.userId);
    await open(small.id);
    const m = await member(small.id);
    await db().transaction((tx) => postTreasury(tx, small.id, [{ category: 'admin_adjustment', amountCents: 300_00, description: 'test', idempotencyKey: `test:merger:${small.id}` }]));
    const [before] = await db().select().from(organizations).where(eq(organizations.id, big.id));
    const { id } = await proposeMerger(db(), bigOwner.userId, small.id);
    expect(await code(proposeMerger(db(), m.userId, big.id))).toBe('forbidden');
    expect(await code(acceptMerger(db(), bigOwner.userId, id))).toBe('not_found');
    await acceptMerger(db(), smallOwner.userId, id);
    expect((await db().select().from(organizations).where(eq(organizations.id, small.id))).length).toBe(0);
    const moved = await db().select().from(companyMembers).where(eq(companyMembers.companyId, big.id));
    expect(moved.map((r) => r.userId)).toEqual(expect.arrayContaining([smallOwner.userId, m.userId]));
    expect(moved.find((r) => r.userId === m.userId)!.departmentId).not.toBeNull();
    const [after] = await db().select().from(organizations).where(eq(organizations.id, big.id));
    expect(after!.treasuryCents - before!.treasuryCents).toBeGreaterThanOrEqual(300_00);
    expect((await db().select().from(mergerOffers).where(eq(mergerOffers.id, id))).length).toBe(0);

    await transferOwnership(db(), bigOwner.userId, m.userId, false);
    const history = await companyHistory(db(), big.id);
    expect(history!.owners.map((o) => o.userId)).toEqual([bigOwner.userId, m.userId]);
    const owners = await db().select().from(companyOwners).where(eq(companyOwners.organizationId, big.id));
    expect(owners.filter((o) => !o.toAt).length).toBe(1);
  });
});

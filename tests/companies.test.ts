import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { companyLevelForXp, companyXpForLevel, maxRanks, memberBonuses, memberCapacity, sniffImage } from '@/lib/game/company';
import { rentalFeeCents } from '@/lib/game/economy';
import { adminResetCompanyBranding } from '@/server/admin';
import { closeDb } from '@/server/db/client';
import { companies, companyAssets, companyMembers, companyRanks, ledgerEntries, organizations, treasuryEntries, users, vehicles } from '@/server/db/schema';
import { foundCompany } from '@/server/game/company';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import {
  buyCompanyUpgrade,
  createRank,
  decideApplication,
  deleteRank,
  joinCompany,
  kickMember,
  leaveCompany,
  membershipOf,
  pendingApplications,
  setMemberRank,
  depositToTreasury,
  dissolveCompany,
  transferOwnership,
  updateProfile,
  updateRank,
  updateSettings,
  uploadAsset,
} from '@/server/game/membership';
import { db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(async () => closeDb());

const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
/** The organisation owned by a player. */
const companyOf = async (userId: string) => (await db().select().from(organizations).where(eq(organizations.ownerId, userId)))[0]!;
const orgById = async (id: string) => (await db().select().from(organizations).where(eq(organizations.id, id)))[0];
const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const ranksOf = async (companyId: string) => db().select().from(companyRanks).where(eq(companyRanks.companyId, companyId)).orderBy(companyRanks.priority);
const truckOf = async (companyId: string) => (await db().select().from(vehicles).where(and(eq(vehicles.companyId, companyId), sql`${vehicles.soldAt} is null`)))[0]!;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('company rules', () => {
  it('levels, bonuses, capacity and unlocks', () => {
    expect(companyXpForLevel(1)).toBe(0);
    expect(companyLevelForXp(companyXpForLevel(3))).toBe(3);
    expect(companyLevelForXp(companyXpForLevel(3) - 1)).toBe(2);
    expect(memberBonuses({})).toEqual({ rewardMultiplier: 1, rentalShareReduction: 0, xpMultiplier: 1, repairDiscount: 0, parkingSlots: 0, warehouseTons: 0, restCut: 0 });
    const b = memberBonuses({ logistics: 2, rental_partner: 1, training: 3 });
    expect(b.rewardMultiplier).toBeCloseTo(1.04);
    expect(b.rentalShareReduction).toBeCloseTo(0.05);
    expect(b.xpMultiplier).toBeCloseTo(1.15);
    expect(memberCapacity({ capacity: 2 })).toBe(15);
    expect([maxRanks(1, false), maxRanks(2, false), maxRanks(4, false)]).toEqual([4, 6, 10]);
    // Company roles (v1.2): two more places for the ready-made roles.
    expect([maxRanks(1), maxRanks(2), maxRanks(4)]).toEqual([6, 8, 12]);
    expect(rentalFeeCents(1000_00, 0, 0.05)).toBe(400_00);
    expect(rentalFeeCents(1000_00, 0, 0.9)).toBe(200_00); // never below 20 %
  });

  it('recognises images by content, not by name (no SVG)', () => {
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe('image/jpeg');
    expect(sniffImage(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffImage(new TextEncoder().encode('<svg onload="alert(1)"></svg>'))).toBeNull();
  });
});

describe('company membership', () => {
  it('founding creates default ranks with the owner as a member', async () => {
    const owner = await playerWithCompany();
    const company = await companyOf(owner.userId);
    const ranks = await ranksOf(company.id);
    expect(ranks.map((r) => r.name)).toEqual(['Собственик', 'Заместник', 'Диспечер', 'Шофьор']);
    const m = await membershipOf(db(), owner.userId);
    expect(m?.rank.isOwner).toBe(true);
    expect(await code(leaveCompany(db(), owner.userId))).toBe('owner_must_transfer');
  });

  it('applications: apply, approve, ranks and kicking follow the hierarchy', async () => {
    const owner = await playerWithCompany();
    const company = await companyOf(owner.userId);
    const a = await newPlayer();
    const b = await newPlayer();

    expect(await joinCompany(db(), a.userId, company.id, 'Здравейте')).toBe('applied');
    expect(await code(joinCompany(db(), a.userId, company.id))).toBe('already_applied');
    expect(await joinCompany(db(), b.userId, company.id)).toBe('applied');
    const pending = await pendingApplications(db(), company.id);
    expect(pending).toHaveLength(2);

    // A non-member cannot decide; the owner can.
    expect(await code(decideApplication(db(), b.userId, pending[0]!.application.id, true))).toBe('not_member');
    for (const p of pending) expect(await decideApplication(db(), owner.userId, p.application.id, true)).toBe('accepted');
    expect((await membershipOf(db(), a.userId))?.rank.name).toBe('Шофьор');

    // A member cannot join or found another company while in this one.
    const other = await playerWithCompany();
    expect(await code(joinCompany(db(), a.userId, (await companyOf(other.userId)).id))).toBe('already_member');
    await db().update(users).set({ level: 2 }).where(eq(users.id, a.userId));
    expect(await code(foundCompany(db(), a.userId, { name: 'Бягство', hqCityId: a.hq.id }))).toBe('already_member');

    // Promote A to dispatcher (manage_members): A may manage B (a driver) but not the owner or the deputy rank.
    const ranks = await ranksOf(company.id);
    const deputy = ranks.find((r) => r.name === 'Заместник')!;
    const dispatcher = ranks.find((r) => r.name === 'Диспечер')!;
    expect(await code(setMemberRank(db(), b.userId, a.userId, dispatcher.id))).toBe('forbidden');
    await setMemberRank(db(), owner.userId, a.userId, dispatcher.id);
    expect(await code(setMemberRank(db(), a.userId, b.userId, deputy.id))).toBe('forbidden');
    expect(await code(kickMember(db(), a.userId, owner.userId))).toBe('forbidden');
    await kickMember(db(), a.userId, b.userId);
    expect(await membershipOf(db(), b.userId)).toBeNull();

    // Members can leave.
    await leaveCompany(db(), a.userId);
    expect(await membershipOf(db(), a.userId)).toBeNull();
  });

  it('open recruitment, minimum level and capacity', async () => {
    const owner = await playerWithCompany();
    const company = await companyOf(owner.userId);
    await updateSettings(db(), owner.userId, { recruitment: 'open', minJoinLevel: 2, contributionRate: 0.1 });
    const low = await newPlayer();
    expect(await code(joinCompany(db(), low.userId, company.id))).toBe('join_level');
    await db().update(users).set({ level: 2 }).where(eq(users.id, low.userId));
    expect(await joinCompany(db(), low.userId, company.id)).toBe('joined');

    await updateSettings(db(), owner.userId, { recruitment: 'open', minJoinLevel: 1, contributionRate: 0.1 });
    for (let i = 0; i < 3; i++) expect(await joinCompany(db(), (await newPlayer()).userId, company.id)).toBe('joined');
    expect(await code(joinCompany(db(), (await newPlayer()).userId, company.id))).toBe('company_full'); // 5 members

    await updateSettings(db(), owner.userId, { recruitment: 'closed', minJoinLevel: 1, contributionRate: 0.1 });
    expect(await code(joinCompany(db(), (await newPlayer()).userId, company.id))).toBe('recruitment_closed');
  });

  it('ranks: limit by company level, cannot grant missing permissions, cannot delete used ranks', async () => {
    const owner = await playerWithCompany();
    const company = await companyOf(owner.userId);
    expect(await code(createRank(db(), owner.userId, { name: 'Стажант', priority: 40, permissions: [] }))).toBe('rank_limit');
    await db().update(organizations).set({ companyLevel: 2 }).where(eq(organizations.id, company.id));
    const intern = await createRank(db(), owner.userId, { name: 'Стажант', priority: 40, permissions: [] });
    expect(intern.name).toBe('Стажант');

    // A dispatcher with manage_ranks cannot hand out manage_upgrades.
    const ranks = await ranksOf(company.id);
    const dispatcher = ranks.find((r) => r.name === 'Диспечер')!;
    await updateRank(db(), owner.userId, dispatcher.id, { name: 'Диспечер', priority: 20, permissions: ['manage_members', 'manage_ranks'] });
    const d = await newPlayer();
    await updateSettings(db(), owner.userId, { recruitment: 'open', minJoinLevel: 1, contributionRate: 0.05 });
    await joinCompany(db(), d.userId, company.id);
    await setMemberRank(db(), owner.userId, d.userId, dispatcher.id);
    expect(await code(updateRank(db(), d.userId, intern.id, { name: 'Стажант', priority: 40, permissions: ['manage_upgrades'] }))).toBe('forbidden');
    expect(await code(updateRank(db(), d.userId, dispatcher.id, { name: 'Шеф', priority: 21, permissions: ['manage_members', 'manage_ranks'] }))).toBe('forbidden');

    // The newest member got the most junior rank, so it is in use.
    const newcomer = await newPlayer();
    await joinCompany(db(), newcomer.userId, company.id);
    expect((await membershipOf(db(), newcomer.userId))?.rank.id).toBe(intern.id);
    expect(await code(deleteRank(db(), owner.userId, intern.id))).toBe('rank_in_use');
  });

  it('profile and images respect unlocks and validate content', async () => {
    const owner = await playerWithCompany();
    const company = await companyOf(owner.userId);
    await updateProfile(db(), owner.userId, { description: 'Возим из Балканите.', rules: '1. Навреме.' });
    expect((await companyOf(owner.userId)).description).toBe('Возим из Балканите.');
    expect(await code(updateProfile(db(), owner.userId, { description: '', rules: '', tag: 'БЕКС' }))).toBe('locked');
    expect(await code(uploadAsset(db(), owner.userId, 'banner', PNG))).toBe('locked');
    expect(await code(uploadAsset(db(), owner.userId, 'logo', new TextEncoder().encode('<svg/>')))).toBe('bad_image');
    expect(await code(uploadAsset(db(), owner.userId, 'logo', new Uint8Array(400 * 1024)))).toBe('too_large');
    await uploadAsset(db(), owner.userId, 'logo', PNG);
    const [asset] = await db().select().from(companyAssets).where(eq(companyAssets.companyId, company.id));
    expect(asset?.mime).toBe('image/png');
    expect((await companyOf(owner.userId)).brandingVersion).toBe(1);

    // A plain driver cannot edit the profile.
    await updateSettings(db(), owner.userId, { recruitment: 'open', minJoinLevel: 1, contributionRate: 0.05 });
    const driver = await newPlayer();
    await joinCompany(db(), driver.userId, company.id);
    expect(await code(updateProfile(db(), driver.userId, { description: 'x', rules: '' }))).toBe('forbidden');

    // Moderation clears everything and is audited.
    await db().update(users).set({ role: 'support' }).where(eq(users.id, driver.userId));
    await adminResetCompanyBranding(db(), { id: driver.userId, role: 'support' } as never, company.id, 'неподходящо лого');
    expect(await db().select().from(companyAssets).where(eq(companyAssets.companyId, company.id))).toHaveLength(0);
    expect((await companyOf(owner.userId)).description).toBeNull();
  });

  it('the company has its own treasury, separate from the owner’s money', async () => {
    const owner = await playerWithCompany('Sofia', 20_000_00);
    const company = await companyOf(owner.userId);
    expect(company.treasuryCents).toBe(0);
    await updateSettings(db(), owner.userId, { recruitment: 'open', minJoinLevel: 1, contributionRate: 0.1 });

    // Upgrades are paid only from the treasury — never from the owner's personal balance.
    expect(await code(buyCompanyUpgrade(db(), owner.userId, 'logistics'))).toBe('insufficient_treasury');
    const personalBefore = (await accountOf(owner.userId)).balanceCents;
    expect(await code(depositToTreasury(db(), owner.userId, 1_000_000))).toBe('insufficient_funds');
    await depositToTreasury(db(), owner.userId, 20_000);
    expect((await accountOf(owner.userId)).balanceCents).toBe(personalBefore - 20_000_00);
    expect((await orgById(company.id))!.treasuryCents).toBe(20_000_00);

    expect(await code(buyCompanyUpgrade(db(), owner.userId, 'logistics'))).toBe('ok');
    expect(await code(buyCompanyUpgrade(db(), owner.userId, 'logistics'))).toBe('company_level'); // level 2 needs company level 2
    await buyCompanyUpgrade(db(), owner.userId, 'rental_partner');
    const treasuryBefore = (await orgById(company.id))!.treasuryCents;
    expect(treasuryBefore).toBe(20_000_00 - 8_000_00 - 10_000_00);
    expect((await accountOf(owner.userId)).balanceCents).toBe(personalBefore - 20_000_00);
    const spent = await db().select().from(treasuryEntries).where(and(eq(treasuryEntries.organizationId, company.id), eq(treasuryEntries.category, 'company_upgrade')));
    expect(spent).toHaveLength(2);

    const member = await newPlayer();
    await joinCompany(db(), member.userId, company.id);
    const account = await accountOf(member.userId);
    const contract = await makeContract('Sofia', 'Plovdiv', { rewardCents: 1000_00 });
    const d = await acceptContract(db(), member.userId, contract.id, (await truckOf(account.id)).id);
    expect(d.rentalFeeCents).toBe(rentalFeeCents(1000_00, d.emptyKm + d.loadedKm, 0.05));

    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000));
    const entries = await db().select().from(ledgerEntries).where(sql`${ledgerEntries.idempotencyKey} like ${`delivery:${d.id}:%`}`);
    const amount = (key: string) => entries.find((e) => e.idempotencyKey === `delivery:${d.id}:${key}`)?.amountCents;
    expect(amount('company-bonus')).toBe(20_00); // +2 % of 1 000 €
    expect(amount('contribution')).toBe(-100_00); // 10 % to the treasury
    const [inflow] = await db().select().from(treasuryEntries).where(eq(treasuryEntries.idempotencyKey, `delivery:${d.id}:contribution-in`));
    expect(inflow?.amountCents).toBe(100_00);
    expect(inflow?.organizationId).toBe(company.id);
    expect((await orgById(company.id))!.treasuryCents).toBe(treasuryBefore + 100_00);
    expect((await accountOf(owner.userId)).balanceCents).toBe(personalBefore - 20_000_00); // owner's money untouched

    const [stats] = await db().select().from(companyMembers).where(eq(companyMembers.userId, member.userId));
    expect(stats?.deliveries).toBe(1);
    expect(stats?.contributedCents).toBe(100_00);
    expect((await orgById(company.id))!.companyXp).toBe(stats!.xpContributed);
    // Settlement is exactly-once: a second pass changes nothing.
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 2000));
    expect((await orgById(company.id))!.treasuryCents).toBe(treasuryBefore + 100_00);
  });

  it('an owner can leave only by handing the company over to a member', async () => {
    const owner = await playerWithCompany();
    const company = await companyOf(owner.userId);
    await updateSettings(db(), owner.userId, { recruitment: 'open', minJoinLevel: 1, contributionRate: 0.05 });
    const heir = await newPlayer('Varna');
    const outsider = await newPlayer();
    await joinCompany(db(), heir.userId, company.id);

    expect(await code(leaveCompany(db(), owner.userId))).toBe('owner_must_transfer');
    expect(await code(transferOwnership(db(), heir.userId, owner.userId, false))).toBe('forbidden');
    expect(await code(transferOwnership(db(), owner.userId, outsider.userId, true))).toBe('member_not_found');
    expect(await code(dissolveCompany(db(), owner.userId))).toBe('has_members');

    await transferOwnership(db(), owner.userId, heir.userId, true);
    const org = (await orgById(company.id))!;
    expect(org.ownerId).toBe(heir.userId);
    expect((await membershipOf(db(), heir.userId))?.rank.isOwner).toBe(true);
    expect(await membershipOf(db(), owner.userId)).toBeNull();
    // The new owner gets the operator licence and a depot in the company's HQ city.
    const heirAccount = await accountOf(heir.userId);
    expect(heirAccount.kind).toBe('company');
    // The old owner keeps their licence, fleet and money, and may found a new company later.
    expect((await accountOf(owner.userId)).kind).toBe('company');
  });

  it('the owner can stay as the most senior rank, or close a company with no other members', async () => {
    const owner = await playerWithCompany();
    const company = await companyOf(owner.userId);
    await updateSettings(db(), owner.userId, { recruitment: 'open', minJoinLevel: 1, contributionRate: 0.05 });
    const heir = await newPlayer();
    await joinCompany(db(), heir.userId, company.id);
    await transferOwnership(db(), owner.userId, heir.userId, false);
    expect((await membershipOf(db(), owner.userId))?.rank.name).toBe('Заместник');

    // A solo owner closes the company; the treasury is paid out to them.
    const solo = await playerWithCompany('Plovdiv', 1_000_00);
    const soloOrg = await companyOf(solo.userId);
    await depositToTreasury(db(), solo.userId, 500);
    const before = (await accountOf(solo.userId)).balanceCents;
    expect(await dissolveCompany(db(), solo.userId)).toBe(500_00);
    expect((await accountOf(solo.userId)).balanceCents).toBe(before + 500_00);
    expect(await orgById(soloOrg.id)).toBeUndefined();
    expect(await membershipOf(db(), solo.userId)).toBeNull();
  });
});

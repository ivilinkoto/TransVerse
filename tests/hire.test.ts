import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/server/db/client';
import { companies, contracts, jobOffers, ledgerEntries, organizations, treasuryEntries, users, vehicles } from '@/server/db/schema';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { declineJob, hireCandidates, offerJob, setForHire } from '@/server/game/hire';
import { db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const truck = async (userId: string) => {
  const [c] = await db().select().from(companies).where(eq(companies.ownerId, userId));
  const [v] = await db().select().from(vehicles).where(and(eq(vehicles.companyId, c!.id), sql`${vehicles.soldAt} is null`));
  return { accountId: c!.id, vehicleId: v!.id };
};

describe('loads handed to free drivers', () => {
  it('company offers, the driver takes it and pays the commission into the treasury', async () => {
    const owner = await playerWithCompany('Sofia');
    const [org] = await db().select().from(organizations).where(eq(organizations.ownerId, owner.userId));
    const driver = await newPlayer('Sofia');
    const contract = await makeContract('Sofia', 'Plovdiv');

    expect(await code(offerJob(db(), owner.userId, { contractId: contract.id, toUserId: driver.userId, share: 0.1 }))).toBe('not_for_hire');
    await setForHire(db(), driver.userId, true);
    expect((await hireCandidates(db(), owner.userId, contract.id)).map((c) => c.username)).toContain(driver.username);

    await offerJob(db(), owner.userId, { contractId: contract.id, toUserId: driver.userId, share: 0.1 });
    const [held] = await db().select().from(contracts).where(eq(contracts.id, contract.id));
    expect(held!.reservedByCompanyId).toBe((await truck(driver.userId)).accountId);
    // Nobody else can take the held load.
    const other = await newPlayer('Sofia');
    expect(await code(acceptContract(db(), other.userId, contract.id, (await truck(other.userId)).vehicleId))).toBe('reserved');

    const t = await truck(driver.userId);
    const d = await acceptContract(db(), driver.userId, contract.id, t.vehicleId);
    const [offer] = await db().select().from(jobOffers).where(eq(jobOffers.contractId, contract.id));
    expect(offer).toMatchObject({ status: 'accepted', deliveryId: d.id });

    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), t.accountId);
    const expected = Math.round(contract.rewardCents * 0.1);
    const [out] = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, t.accountId), eq(ledgerEntries.category, 'hire_commission')));
    expect(out!.amountCents).toBe(-expected);
    const [inn] = await db().select().from(treasuryEntries).where(and(eq(treasuryEntries.organizationId, org!.id), eq(treasuryEntries.category, 'hire_commission')));
    expect(inn!.amountCents).toBe(expected);
    const [done] = await db().select().from(jobOffers).where(eq(jobOffers.id, offer!.id));
    expect(done!.status).toBe('done');
  });

  it('only members with the right may offer; a decline frees the load', async () => {
    const owner = await playerWithCompany('Sofia');
    const driver = await newPlayer('Sofia');
    await setForHire(db(), driver.userId, true);
    const outsider = await newPlayer('Sofia');
    const contract = await makeContract('Sofia', 'Burgas');
    expect(await code(offerJob(db(), outsider.userId, { contractId: contract.id, toUserId: driver.userId, share: 0.1 }))).toBe('not_member');
    expect(await code(offerJob(db(), owner.userId, { contractId: contract.id, toUserId: driver.userId, share: 0.5 }))).not.toBe('ok');
    const { id } = await offerJob(db(), owner.userId, { contractId: contract.id, toUserId: driver.userId, share: 0.2 });
    await declineJob(db(), driver.userId, id);
    const [freed] = await db().select().from(contracts).where(eq(contracts.id, contract.id));
    expect(freed!.reservedByCompanyId).toBeNull();
    expect(await code(declineJob(db(), driver.userId, id))).toBe('offer_closed');
    await db().update(users).set({ forHire: false }).where(eq(users.id, driver.userId));
  });
});

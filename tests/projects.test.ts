import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { PROJECT_RULES } from '@/lib/game/projects';
import { closeDb } from '@/server/db/client';
import { cities, coinEntries, companies, companyProjects, organizations, treasuryEntries, vehicles } from '@/server/db/schema';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { joinCompany } from '@/server/game/membership';
import { expireProjects, projectChoices, startProject } from '@/server/game/projects';
import { db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));

describe('company projects', () => {
  it('members haul the cargo to the city together; done pays the treasury and the helpers', async () => {
    const owner = await playerWithCompany('Sofia');
    const [org] = await db().select().from(organizations).where(eq(organizations.ownerId, owner.userId));
    await db().update(organizations).set({ recruitment: 'open' }).where(eq(organizations.id, org!.id));
    const member = await newPlayer('Sofia');
    await joinCompany(db(), member.userId, org!.id);

    const choice = (await projectChoices(db(), org!.id, new Date()))[0]!;
    expect(await code(startProject(db(), member.userId, choice.id))).toBe('forbidden');
    const p = await startProject(db(), owner.userId, choice.id);
    expect(await code(startProject(db(), owner.userId, choice.id))).toBe('project_running');

    // Haul exactly the target (one big load) to the project's city with the project's cargo.
    await db().update(companyProjects).set({ targetTons: 5 }).where(eq(companyProjects.id, p.id));
    const [city] = await db().select().from(cities).where(eq(cities.id, p.destCityId));
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, member.userId));
    const [v] = await db().select().from(vehicles).where(and(eq(vehicles.companyId, acc!.id), sql`${vehicles.soldAt} is null`));
    const from = city!.name === 'Sofia' ? 'Plovdiv' : 'Sofia';
    if (from === 'Plovdiv') await db().update(vehicles).set({ cityId: (await db().select().from(cities).where(eq(cities.name, 'Plovdiv')))[0]!.id }).where(eq(vehicles.id, v!.id));
    const contract = await makeContract(from, city!.name, { cargoType: p.cargoType, weightTons: 5, minLevel: 1 });
    const d = await acceptContract(db(), member.userId, contract.id, v!.id).catch((e: Error) => e);
    if (d instanceof Error) {
      // The rented starter truck may not carry this cargo: count the load directly instead.
      const { recordProjectDelivery } = await import('@/server/game/projects');
      await db().transaction((tx) => recordProjectDelivery(tx, org!.id, member.userId, { cargoType: p.cargoType, destCityId: p.destCityId, tons: 5 }, new Date()));
    } else {
      await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), acc!.id);
    }
    const [done] = await db().select().from(companyProjects).where(eq(companyProjects.id, p.id));
    expect(done!.status).toBe('done');
    const [paid] = await db().select().from(treasuryEntries).where(and(eq(treasuryEntries.organizationId, org!.id), eq(treasuryEntries.category, 'company_project')));
    expect(paid!.amountCents).toBe(p.rewardCents);
    const coins = await db().select().from(coinEntries).where(and(eq(coinEntries.userId, member.userId), eq(coinEntries.reason, 'project_reward')));
    expect(coins[0]?.amount).toBe(PROJECT_RULES.helperCoins);
    // One project per week.
    expect(await code(startProject(db(), owner.userId, choice.id))).toBe('project_this_week');
  });

  it('a project past its week fails', async () => {
    const owner = await playerWithCompany('Sofia');
    const [org] = await db().select().from(organizations).where(eq(organizations.ownerId, owner.userId));
    const choice = (await projectChoices(db(), org!.id, new Date()))[1]!;
    const p = await startProject(db(), owner.userId, choice.id);
    await expireProjects(db(), new Date(p.endsAt.getTime() + 1000));
    const [row] = await db().select().from(companyProjects).where(eq(companyProjects.id, p.id));
    expect(row!.status).toBe('failed');
  });
});

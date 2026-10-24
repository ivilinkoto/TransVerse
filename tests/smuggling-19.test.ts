import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { borderCheckChance, fineCents, runCatchChance, SMUGGLING, undergroundTier } from '@/lib/game/smuggling';
import { closeDb } from '@/server/db/client';
import { companies, contracts, deliveries, ledgerEntries, smugglingContacts, users, vehicles } from '@/server/db/schema';
import { openContracts } from '@/server/game/contracts';
import { acceptContract, settleDelivery } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { buyCompartment, reportShadyOffer, setSmugglingOptIn, smugglingOffers, smugglingProfile } from '@/server/game/smuggling';
import { db, grantLicences, newPlayer } from './helpers';

afterAll(() => closeDb());
beforeAll(() => {
  process.env.ROAD_EVENTS = 'off';
});

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const truckOf = async (userId: string) => (await db().select().from(vehicles).where(eq(vehicles.companyId, (await accountOf(userId)).id)))[0]!;
// 19:00 in Sofia, in the future (so the offers have not expired).
const evening = (day: number) => new Date(Date.UTC(2031, 0, day, 17, 0, 0));

async function smuggler() {
  const p = await newPlayer();
  await db().update(users).set({ level: SMUGGLING.minLevel }).where(eq(users.id, p.userId));
  await grantLicences(p.userId, 'international', 'customs', 'adr');
  const truck = await truckOf(p.userId);
  await db().update(vehicles).set({ ownership: 'owned' }).where(eq(vehicles.id, truck.id));
  await setSmugglingOptIn(db(), p.userId, true);
  return { ...p, truck };
}

/** Takes an offer and lets it arrive; `roll` decides the customs check (0 = found, 0.999 = passes). */
async function run(userId: string, contractId: string, vehicleId: string, day: number, roll: number) {
  const d = await acceptContract(db(), userId, contractId, vehicleId, evening(day));
  const [row] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
  const spy = vi.spyOn(Math, 'random').mockReturnValue(roll);
  try {
    await db().transaction((tx) => settleDelivery(tx, d.id, new Date(row!.etaAt.getTime() + 60_000)));
  } finally {
    spy.mockRestore();
  }
  return d.id;
}

describe('v1.9 smuggling (two reputations)', () => {
  it('the rules: heat and police raise the chance, a compartment halves it, a fine never takes more than there is', () => {
    const calm = borderCheckChance({ heat: 0, policeReports: 0, compartment: false, contactLevel: 0 });
    const hot = borderCheckChance({ heat: 80, policeReports: 2, compartment: false, contactLevel: 0 });
    expect(hot).toBeGreaterThan(calm);
    expect(borderCheckChance({ heat: 80, policeReports: 2, compartment: true, contactLevel: 0 })).toBeCloseTo(hot / 2);
    expect(runCatchChance(2, 0.1)).toBeCloseTo(0.19);
    expect(fineCents(1_000_00, 200_00)).toBe(200_00);
    expect(fineCents(1_000_00, -50_00)).toBe(0);
    expect(undergroundTier(120).name).toBe('Доверен');
  });

  it('opt-in only from level 10; offers only in the evening, personal and never on the board', async () => {
    const young = await newPlayer();
    expect(await code(setSmugglingOptIn(db(), young.userId, true))).toBe('level_required');
    const p = await smuggler();
    expect(await smugglingOffers(db(), p.userId, new Date(Date.UTC(2031, 0, 2, 9, 0, 0)))).toHaveLength(0);
    const offers = await smugglingOffers(db(), p.userId, evening(2));
    expect(offers.length).toBe(SMUGGLING.offers);
    expect(offers.every((o) => o.shady && o.createdBy === p.userId && o.originCityId === p.truck.cityId)).toBe(true);
    const board = await openContracts(db(), { limit: 300 }, evening(2));
    expect(board.some((c) => c.shady)).toBe(false);
    // Somebody else cannot take it.
    const other = await smuggler();
    expect(await code(acceptContract(db(), other.userId, offers[0]!.id, other.truck.id, evening(2)))).toBe('not_yours');
    // Off again: the open offers go.
    await setSmugglingOptIn(db(), p.userId, false);
    const left = await db().select().from(contracts).where(and(eq(contracts.createdBy, p.userId), eq(contracts.shady, true), eq(contracts.status, 'open')));
    expect(left).toHaveLength(0);
  });

  it('a rented truck cannot carry it', async () => {
    const p = await smuggler();
    const [offer] = await smugglingOffers(db(), p.userId, evening(3));
    await db().update(vehicles).set({ ownership: 'rented' }).where(eq(vehicles.id, p.truck.id));
    expect(await code(acceptContract(db(), p.userId, offer!.id, p.truck.id, evening(3)))).toBe('rented_truck');
  });

  it('caught: no pay, a fine (never below 0), more heat, less underground', async () => {
    const p = await smuggler();
    const [offer] = await smugglingOffers(db(), p.userId, evening(4));
    const acc = await accountOf(p.userId);
    const id = await run(p.userId, offer!.id, p.truck.id, 4, 0);
    const entries = await db().select().from(ledgerEntries).where(eq(ledgerEntries.companyId, acc.id));
    expect(entries.some((e) => e.category === 'freight' && e.refId === id)).toBe(false);
    expect(entries.some((e) => e.category === 'smuggling_fine' && e.refId === id)).toBe(true);
    const [after] = await db().select().from(companies).where(eq(companies.id, acc.id));
    expect(after!.balanceCents).toBeGreaterThanOrEqual(0);
    const prof = await smugglingProfile(db(), p.userId);
    expect(prof).toMatchObject({ runs: 1, caught: 1, heat: SMUGGLING.heatCaught, underground: 0 });
  });

  it('passed: pays ×2–3, the underground grows, a contact in the city; reporting gives honest reputation', async () => {
    const p = await smuggler();
    const [offer] = await smugglingOffers(db(), p.userId, evening(5));
    const acc = await accountOf(p.userId);
    const id = await run(p.userId, offer!.id, p.truck.id, 5, 0.999);
    const [freight] = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, acc.id), eq(ledgerEntries.category, 'freight'), eq(ledgerEntries.refId, id)));
    expect(freight!.amountCents).toBeGreaterThan(0);
    const prof = await smugglingProfile(db(), p.userId);
    expect(prof).toMatchObject({ runs: 1, caught: 0, heat: SMUGGLING.heatPerRun, underground: SMUGGLING.undergroundRun });
    const contacts = await db().select().from(smugglingContacts).where(eq(smugglingContacts.userId, p.userId));
    expect(contacts).toHaveLength(1);
    // The black market needs „Познат“.
    expect(await code(buyCompartment(db(), p.userId, p.truck.id, evening(5)))).toBe('tier_required');

    const offers = await smugglingOffers(db(), p.userId, evening(6));
    const before = (await accountOf(p.userId)).reputation;
    await reportShadyOffer(db(), p.userId, offers[0]!.id, evening(6));
    expect((await accountOf(p.userId)).reputation).toBeCloseTo(before + SMUGGLING.reportReputation);
    expect((await smugglingProfile(db(), p.userId)).heat).toBe(0);
  });
});

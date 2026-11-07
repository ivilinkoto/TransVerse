import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { PARTNER } from '@/lib/game/partner-loads';
import { closeDb } from '@/server/db/client';
import { chatMessages, companies, contracts, deliveries, directMessages, ledgerEntries, relays, userBadges, users, vehicles } from '@/server/db/schema';
import { openContracts } from '@/server/game/contracts';
import { acceptContract, settleDelivery } from '@/server/game/deliveries';
import { acceptPartner, askPartner, invitePartner, loadsTogether, myPartnerLoads, partnerLoadCard } from '@/server/game/partner-loads';
import { db, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());
beforeAll(() => {
  process.env.ROAD_EVENTS = 'off';
});

const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const truckOf = async (userId: string) => (await db().select().from(vehicles).where(eq(vehicles.companyId, (await accountOf(userId)).id)))[0]!;
const nameOf = async (userId: string) => (await db().select({ username: users.username }).from(users).where(eq(users.id, userId)))[0]!.username;
const accept = async (userId: string, contractId: string) => acceptContract(db(), userId, contractId, (await truckOf(userId)).id);
async function arrive(id: string) {
  const [row] = await db().select().from(deliveries).where(eq(deliveries.id, id));
  await db().transaction((tx) => settleDelivery(tx, id, new Date(row!.etaAt.getTime() + 60_000)));
}
async function partnerLoad() {
  const leg1 = await makeContract('Sofia', 'Plovdiv', { rewardCents: 800_00 });
  const leg2 = await makeContract('Plovdiv', 'Burgas', { rewardCents: 900_00, status: 'held' });
  const [r] = await db().insert(relays).values({ originCityId: leg1.originCityId, relayCityId: leg1.destCityId, destCityId: leg2.destCityId, leg1ContractId: leg1.id, leg2ContractId: leg2.id, partner: true }).returning();
  await db().update(contracts).set({ relayId: r!.id, relayLeg: 1 }).where(eq(contracts.id, leg1.id));
  await db().update(contracts).set({ relayId: r!.id, relayLeg: 2 }).where(eq(contracts.id, leg2.id));
  return { r: r!, leg1, leg2 };
}

describe('1.2.6 partner loads', () => {
  it('invited in private messages: the second leg is only for the partner; both on time — the bonus, points and the count together', async () => {
    const a = await newPlayer('Sofia');
    const b = await newPlayer('Plovdiv');
    const c = await newPlayer('Plovdiv');
    const { r, leg1, leg2 } = await partnerLoad();
    const d1 = await accept(a.userId, leg1.id);
    expect((await db().select().from(relays).where(eq(relays.id, r.id)))[0]!.leaderId).toBe(a.userId);
    await expect(invitePartner(db(), c.userId, r.id, await nameOf(b.userId))).rejects.toThrow();
    await invitePartner(db(), a.userId, r.id, await nameOf(b.userId));
    const dm = await db().select().from(directMessages).where(and(eq(directMessages.senderId, a.userId), eq(directMessages.recipientId, b.userId)));
    expect(dm[0]!.body).toContain(`/game/contracts?partner=${r.id}`);
    expect((await myPartnerLoads(db(), b.userId))[0]).toMatchObject({ lead: false, leader: await nameOf(a.userId) });

    await arrive(d1.id);
    const [open] = await db().select().from(contracts).where(eq(contracts.id, leg2.id));
    expect(open!.status).toBe('open');
    // Hidden from others on the board, there for the partner.
    const board = async (userId: string) => (await openContracts(db(), { originCityId: leg2.originCityId, viewerUserId: userId })).some((x) => x.id === leg2.id);
    expect(await board(c.userId)).toBe(false);
    expect(await board(b.userId)).toBe(true);
    await expect(accept(c.userId, leg2.id)).rejects.toThrow(/партньор/);

    const d2 = await accept(b.userId, leg2.id);
    await arrive(d2.id);
    expect((await db().select().from(relays).where(eq(relays.id, r.id)))[0]!.status).toBe('done');
    const [bonus] = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, (await accountOf(b.userId)).id), eq(ledgerEntries.idempotencyKey, `relay:${r.id}:leg2`)));
    expect(bonus!.amountCents).toBe(Math.round(900_00 * PARTNER.bonusShare));
    expect(await loadsTogether(db(), a.userId, b.userId)).toBe(1);
  });

  it('„Потърси в чата“: a line with a button; the first one to answer becomes the partner', async () => {
    const a = await newPlayer('Sofia');
    const b = await newPlayer('Plovdiv');
    const c = await newPlayer('Plovdiv');
    const { r, leg1 } = await partnerLoad();
    await accept(a.userId, leg1.id);
    const me = { id: a.userId, username: await nameOf(a.userId) };
    const { messageId } = await askPartner(db(), me, r.id);
    const [line] = await db().select().from(chatMessages).where(eq(chatMessages.id, messageId));
    expect(line).toMatchObject({ channel: 'global', kind: 'partner' });
    expect((line!.meta as { href?: string }).href).toBe(`/game/contracts?partner=${r.id}`);
    await expect(askPartner(db(), me, r.id)).rejects.toThrow();
    expect((await partnerLoadCard(db(), b.userId, r.id))!.canJoin).toBe(true);
    await acceptPartner(db(), { id: b.userId, username: await nameOf(b.userId) }, r.id);
    await expect(acceptPartner(db(), { id: c.userId, username: await nameOf(c.userId) }, r.id)).rejects.toThrow();
    await expect(acceptPartner(db(), me, r.id)).rejects.toThrow();
    expect((await partnerLoadCard(db(), c.userId, r.id))!.canJoin).toBe(false);
  });

  it('three loads together make trusted partners (a badge for both)', async () => {
    const a = await newPlayer('Sofia');
    const b = await newPlayer('Plovdiv');
    for (let i = 0; i < PARTNER.trustedAfter; i++) {
      const { r, leg1, leg2 } = await partnerLoad();
      const d1 = await accept(a.userId, leg1.id);
      await invitePartner(db(), a.userId, r.id, await nameOf(b.userId));
      await arrive(d1.id);
      // Each one starts from the relay city again.
      await db().update(vehicles).set({ cityId: leg2.originCityId }).where(eq(vehicles.id, (await truckOf(b.userId)).id));
      await db().update(vehicles).set({ cityId: leg1.originCityId }).where(eq(vehicles.id, (await truckOf(a.userId)).id));
      await arrive((await accept(b.userId, leg2.id)).id);
    }
    expect(await loadsTogether(db(), a.userId, b.userId)).toBe(PARTNER.trustedAfter);
    for (const u of [a.userId, b.userId]) expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, u), eq(userBadges.badge, PARTNER.badge)))).toHaveLength(1);
  });
});

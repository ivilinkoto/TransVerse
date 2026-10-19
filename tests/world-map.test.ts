import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/server/db/client';
import { companies, friendships, organizations, users, vehicles } from '@/server/db/schema';
import { joinCompany } from '@/server/game/membership';
import { acceptContract } from '@/server/game/deliveries';
import { worldSnapshot } from '@/server/game/world-map';
import { trackOnline } from '@/server/realtime';
import { db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(async () => closeDb());

const truckOf = async (userId: string) => {
  const [c] = await db().select().from(companies).where(eq(companies.ownerId, userId));
  return (await db().select().from(vehicles).where(and(eq(vehicles.companyId, c!.id), sql`${vehicles.soldAt} is null`)))[0]!;
};

describe('shared world map', () => {
  it('shows every player’s trucks with live schedules, presence and no money data', async () => {
    const driver = await newPlayer('Sofia');
    const parked = await newPlayer('Varna');
    const banned = await newPlayer('Plovdiv');
    await db().update(users).set({ bannedAt: new Date() }).where(eq(users.id, banned.userId));

    const truck = await truckOf(driver.userId);
    const contract = await makeContract('Sofia', 'Burgas');
    await acceptContract(db(), driver.userId, contract.id, truck.id);

    const offline = trackOnline(parked.userId);
    const world = await worldSnapshot(db());
    const moving = world.trucks.find((t) => t.id === truck.id)!;
    expect(moving.player).toBe(driver.username);
    expect(moving.delivery?.destination).toBe('Бургас');
    expect(moving.delivery?.schedule.length).toBeGreaterThan(0);
    expect(world.routes).toHaveProperty(String(moving.delivery!.loaded.routeId));

    const idle = world.trucks.find((t) => t.player === parked.username)!;
    expect(idle.delivery).toBeNull();
    expect(idle.city).toBe('Варна');
    expect(idle.online).toBe(true);
    expect(world.trucks.some((t) => t.player === banned.username)).toBe(false);

    // Only who drives where — no rewards, balances or contract terms.
    expect(JSON.stringify(world)).not.toMatch(/reward|balance|Cents/i);

    offline();
    expect((await worldSnapshot(db())).trucks.find((t) => t.player === parked.username)?.online).toBe(false);
  });

  it('marks the viewer’s friends and company members', async () => {
    const me = await playerWithCompany('Sofia');
    const friend = await newPlayer('Varna');
    const mate = await newPlayer('Plovdiv');
    const stranger = await newPlayer('Ruse');
    await db().insert(friendships).values({ requesterId: friend.userId, addresseeId: me.userId, status: 'accepted' });
    await db().insert(friendships).values({ requesterId: stranger.userId, addresseeId: me.userId, status: 'pending' });
    const [org] = await db().select().from(organizations).where(eq(organizations.ownerId, me.userId));
    await db().update(organizations).set({ recruitment: 'open' }).where(eq(organizations.id, org!.id));
    expect(await joinCompany(db(), mate.userId, org!.id)).toBe('joined');

    const world = await worldSnapshot(db(), new Date(), me.userId);
    const rel = (name: string) => world.trucks.find((t) => t.player === name)?.relation;
    expect(rel(friend.username)).toBe('friend');
    expect(rel(mate.username)).toBe('company');
    expect(rel(stranger.username)).toBeNull();
    // Without a viewer (or for someone else) nobody is marked.
    expect((await worldSnapshot(db())).trucks.every((t) => t.relation === null)).toBe(true);
  });
});

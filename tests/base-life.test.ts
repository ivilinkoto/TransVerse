import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// As released (before the date these are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true, featureDate: () => new Date('2026-01-01T00:00:00Z') }));
import { isNight, plotWeather } from '@/lib/game/ambience';
import { BUILDER_WEEK, levelSpec, PLOT } from '@/lib/game/plot';
import { closeDb } from '@/server/db/client';
import { companies, companyBuilderWeeks, companyBuilds, contracts, deliveries, organizations, users, vehicles } from '@/server/db/schema';
import { companyChat, sendChatMessage } from '@/server/game/chat';
import { pinCompanyMessage, toggleReaction } from '@/server/game/chat-extras';
import { borrowOrgVehicle, buyOrgVehicle, orgFleetView, setOrgVehicleNote } from '@/server/game/company-fleet';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { awardBuildersOfWeek, companyShowcase, recentVisitors } from '@/server/game/base-life';
import { joinCompany, updateSettings } from '@/server/game/membership';
import { channelFeed, postToChannel } from '@/server/game/messages';
import { withReactions } from '@/server/game/chat-extras';
import { orderMaterials, placeBuilding } from '@/server/game/plot';
import { approximateProvider } from '@/server/geo/routing';
import { db, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const orgOf = async (userId: string) => (await db().select().from(organizations).where(eq(organizations.ownerId, userId)))[0]!;
async function companyWithMember() {
  const owner = await playerWithCompany('Sofia');
  const org = await orgOf(owner.userId);
  await updateSettings(db(), owner.userId, { recruitment: 'open', minJoinLevel: 1, contributionRate: 0.05 });
  const member = await newPlayer();
  await joinCompany(db(), member.userId, org.id);
  return { owner, org, member };
}

describe('the look of the plot', () => {
  it('night by the hour in Sofia; rain on some autumn and spring days; leaves in October', () => {
    expect(isNight(new Date('2026-10-20T19:30:00Z'))).toBe(true); // 22:30 in Sofia
    expect(isNight(new Date('2026-10-20T09:00:00Z'))).toBe(false);
    expect(plotWeather(new Date('2026-07-10T12:00:00Z'))).toBeNull();
    expect(plotWeather(new Date('2027-01-10T12:00:00Z'))).toBeNull(); // winter: snow instead
    const october = Array.from({ length: 31 }, (_, d) => plotWeather(new Date(Date.UTC(2026, 9, d + 1, 10))));
    expect(october.every((w) => w === 'rain' || w === 'leaves')).toBe(true);
    expect(october.filter((w) => w === 'rain').length).toBeGreaterThan(3);
    expect(october.filter((w) => w === 'rain').length).toBeLessThan(20);
  });
});

describe('chat reactions and the pinned message', () => {
  it('reactions toggle, count and know who reacted', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    const id = await postToChannel(db(), a.userId, 'global', 'Кой е на път?');
    await toggleReaction(db(), a.userId, 'global', id, '👍');
    await toggleReaction(db(), b.userId, 'global', id, '👍');
    await toggleReaction(db(), b.userId, 'global', id, '🚚');
    expect(await code(toggleReaction(db(), b.userId, 'global', id, '🙂'))).toBe('bad_reaction');
    expect(await code(toggleReaction(db(), b.userId, 'trade', id, '👍'))).toBe('message_not_found');
    let [m] = await withReactions(db(), 'channel', (await channelFeed(db(), 'global', id - 1)).filter((x) => x.id === id), b.userId);
    expect(m!.reactions).toEqual([{ emoji: '👍', count: 2, mine: true, names: [a.username, b.username] }, { emoji: '🚚', count: 1, mine: true, names: [b.username] }]);
    expect(await toggleReaction(db(), b.userId, 'global', id, '👍')).toEqual({ on: false });
    [m] = await withReactions(db(), 'channel', (await channelFeed(db(), 'global', id - 1)).filter((x) => x.id === id), a.userId);
    expect(m!.reactions![0]).toMatchObject({ emoji: '👍', count: 1, mine: true });
  });

  it('only ranks with chat rights pin; the company chat shows the pin and who is online', async () => {
    const { owner, org, member } = await companyWithMember();
    const id = await sendChatMessage(db(), owner.userId, 'Правило №1: материалите първо!');
    expect(await code(pinCompanyMessage(db(), member.userId, id))).toBe('forbidden');
    await pinCompanyMessage(db(), owner.userId, id);
    await db().update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, member.userId));
    const view = await companyChat(db(), member.userId);
    expect(view.pinned).toMatchObject({ id, body: 'Правило №1: материалите първо!' });
    expect(view.online.names).toContain(member.username);
    expect(view.canPin).toBe(false);
    await toggleReaction(db(), member.userId, 'company', id, '❤️');
    expect((await companyChat(db(), owner.userId)).messages.find((m) => m.id === id)!.reactions).toEqual([{ emoji: '❤️', count: 1, mine: false, names: [member.username] }]);
    const other = await playerWithCompany('Sofia');
    expect(await code(pinCompanyMessage(db(), other.userId, id))).toBe('message_not_found');
    await pinCompanyMessage(db(), owner.userId, null);
    expect((await companyChat(db(), owner.userId)).pinned).toBeNull();
    void org;
  });
});

describe('company trucks: notes', () => {
  it('the driver (or ranks with "Развитие") leave a note for the next one', async () => {
    const { owner, org, member } = await companyWithMember();
    await db().update(organizations).set({ treasuryCents: 500_000_00, upgrades: { parking: 1 } }).where(eq(organizations.id, org.id));
    const ov = await buyOrgVehicle(db(), owner.userId, 'hemus-r12-box');
    expect(await code(setOrgVehicleNote(db(), member.userId, ov.id, 'Гумите са за смяна'))).toBe('forbidden');
    await borrowOrgVehicle(db(), member.userId, ov.id);
    await setOrgVehicleNote(db(), member.userId, ov.id, '  Гумите са за смяна  ');
    expect((await orgFleetView(db(), org.id))!.vehicles[0]!.note).toEqual({ text: 'Гумите са за смяна', by: member.username });
    await setOrgVehicleNote(db(), owner.userId, ov.id, '');
    expect((await orgFleetView(db(), org.id))!.vehicles[0]!.note).toBeNull();
  });
});

describe('building life', () => {
  it('the last load pays more; members arriving show in the yard; the builder of the week gets a prize once', async () => {
    const { owner, org } = await companyWithMember();
    await db().update(organizations).set({ treasuryCents: 2_000_000_00 }).where(eq(organizations.id, org.id));
    const t0 = new Date(Date.now() - 8 * 86_400_000);
    const build = await placeBuilding(db(), owner.userId, 'office', 1, 1, t0);
    await orderMaterials(db(), owner.userId, build.id, t0, approximateProvider);
    const loads = await db().select().from(contracts).where(eq(contracts.constructionId, build.id));
    // All but two loads arrive by themselves; the owner hauls one of the last two.
    const keep = loads.filter((c) => c.weightTons <= 7.5).slice(0, 2);
    for (const c of loads.filter((x) => !keep.includes(x))) await db().update(contracts).set({ status: 'taken' }).where(eq(contracts.id, c.id));
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, owner.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
    await db().update(vehicles).set({ cityId: keep[0]!.originCityId }).where(eq(vehicles.id, truck!.id));
    const before = keep[1]!.rewardCents;
    const d = await acceptContract(db(), owner.userId, keep[0]!.id, truck!.id, t0);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), account!.id);
    const [last] = await db().select().from(contracts).where(eq(contracts.id, keep[1]!.id));
    expect(last!.lastLoad).toBe(true);
    expect(last!.rewardCents).toBe(Math.round(before * PLOT.lastLoadFactor));

    // Arrived in the base city a moment ago: the truck stands in the yard.
    expect(await recentVisitors(db(), org.id, org.hqCityId, new Date(d.etaAt.getTime() + 60_000))).toEqual([owner.username]);
    expect(await recentVisitors(db(), org.id, org.hqCityId, new Date(d.etaAt.getTime() + 2 * 3_600_000))).toEqual([]);

    // Enough tonnes for the week: the builder of that week, once.
    await db().update(deliveries).set({ completedAt: new Date(Date.now() - 7 * 86_400_000) }).where(eq(deliveries.id, d.id));
    await db().update(contracts).set({ weightTons: BUILDER_WEEK.minTons + 1 }).where(eq(contracts.id, keep[0]!.id));
    const treasury = (await orgOf(owner.userId)).treasuryCents;
    expect(await awardBuildersOfWeek(db())).toBeGreaterThanOrEqual(1);
    const [week] = await db().select().from(companyBuilderWeeks).where(eq(companyBuilderWeeks.organizationId, org.id));
    expect(week).toMatchObject({ userId: owner.userId, rewardCents: BUILDER_WEEK.rewardCents });
    expect((await orgOf(owner.userId)).treasuryCents).toBe(treasury - BUILDER_WEEK.rewardCents);
    await awardBuildersOfWeek(db());
    expect(await db().select().from(companyBuilderWeeks).where(and(eq(companyBuilderWeeks.organizationId, org.id)))).toHaveLength(1);
    expect((await companyShowcase(db(), org.id)).latestBuilder).toMatchObject({ username: owner.username });
    void levelSpec;
    void companyBuilds;
  });
});

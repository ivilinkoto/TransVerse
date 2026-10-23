import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { featureLive } from '@/lib/game/features';
import { BADGES } from '@/lib/game/halloween';
import { ANNIVERSARY, anniversaryGiftCents, DRIVER_OF_MONTH, anniversaryYears, isPerfectConvoy, LANE_RECORDS, loadedRunMinutes, PERFECT_CONVOY, recordMonth, SHOWCASE, STAFF_BUS } from '@/lib/game/community';
import type { Segment } from '@/lib/game/schedule';
import { money } from '@/lib/format';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, companyMembers, contracts, deliveries, jobState, laneRecords, organizations, trailers, userBadges, users, vehicles } from '@/server/db/schema';
import { periodWindow } from '@/lib/game/missions';
import { featureFor } from '@/server/features';
import { announce } from '@/server/discord/outbox';
import { companyForUser } from './company';
import { fail } from './errors';
import { post, postTreasury } from './finance';
import { badgesOf } from './halloween';
import { membershipOf, notifyMembers, requirePermission } from './membership';
import { notify } from './notify';
import { fleetView } from './queries';
import { addChronicle } from './chronicle';

const cityNames = async (db: DbOrTx, ids: number[]) => {
  const rows = await db.select({ id: cities.id, nameBg: cities.nameBg }).from(cities).where(inArray(cities.id, ids));
  return (id: number) => rows.find((c) => c.id === id)?.nameBg ?? '';
};

// ── The perfect convoy ────────────────────────────────────────────────────

/**
 * Settling the second trip of a convoy: both on time and within a few minutes
 * of each other — each gets an extra bonus (the first one's is paid now too)
 * and the convoy is posted in Discord. Personal accounts only (before any treasury).
 */
export async function settlePerfectConvoy(tx: Tx, d: { id: string; companyId: string; convoyWith: string | null }, own: { userId: string; late: boolean; at: Date; rewardCents: number; originCityId: number; destCityId: number }) {
  if (!d.convoyWith || !(await featureFor(tx, own.userId, 'perfect_convoy', own.at))) return 0;
  const [p] = await tx.select({ id: deliveries.id, status: deliveries.status, late: deliveries.late, completedAt: deliveries.completedAt, companyId: deliveries.companyId, contractId: deliveries.contractId }).from(deliveries).where(eq(deliveries.id, d.convoyWith));
  if (!p || p.status !== 'completed' || !p.completedAt) return 0;
  if (!isPerfectConvoy({ late: own.late, at: own.at.getTime() }, { late: !!p.late, at: p.completedAt.getTime() })) return 0;
  const [pc] = await tx.select({ rewardCents: contracts.rewardCents }).from(contracts).where(eq(contracts.id, p.contractId));
  const [partner] = await tx.select({ ownerId: companies.ownerId, username: users.username }).from(companies).innerJoin(users, eq(users.id, companies.ownerId)).where(eq(companies.id, p.companyId));
  const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, own.userId));
  const mine = Math.round(own.rewardCents * PERFECT_CONVOY.bonusShare);
  const theirs = Math.round((pc?.rewardCents ?? 0) * PERFECT_CONVOY.bonusShare);
  const name = await cityNames(tx, [own.originCityId, own.destCityId]);
  const route = `${name(own.originCityId)} → ${name(own.destCityId)}`;
  await post(tx, d.companyId, [{ category: 'convoy_perfect', amountCents: mine, description: `Перфектен конвой с ${partner!.username}`, idempotencyKey: `delivery:${d.id}:perfect-convoy`, refType: 'delivery', refId: d.id }]);
  const paid = theirs ? await post(tx, p.companyId, [{ category: 'convoy_perfect', amountCents: theirs, description: `Перфектен конвой с ${me!.username}`, idempotencyKey: `delivery:${p.id}:perfect-convoy`, refType: 'delivery', refId: p.id }]) : 0;
  if (paid) await tx.update(deliveries).set({ payoutCents: sql`coalesce(${deliveries.payoutCents}, 0) + ${theirs}` }).where(eq(deliveries.id, p.id));
  await notify(tx, own.userId, 'success', 'Перфектен конвой!', `${route} с ${partner!.username}: двамата навреме и заедно — +${money(mine)}.`, '/game/finance');
  await notify(tx, partner!.ownerId, 'success', 'Перфектен конвой!', `${route} с ${me!.username}: двамата навреме и заедно — +${money(theirs)}.`, '/game/finance');
  if (featureLive('discord_bot', own.at)) {
    await announce(tx, `perfect-convoy:${[d.id, p.id].sort().join(':')}`, 'convoys', {
      embeds: [{ title: `🚚🚚 Перфектен конвой: ${me!.username} и ${partner!.username}`, description: `${route} — двамата пристигнаха навреме и заедно (до ${PERFECT_CONVOY.togetherMin} мин един от друг).`, color: 0x34d399, footer: { text: 'TransVerse · игрови данни' } }],
    }, own.at);
  }
  return mine;
}

// ── Lane records ──────────────────────────────────────────────────────────

/** An on-time loaded run faster than this month's record on the lane takes it. */
export async function recordLaneRun(tx: Tx, userId: string, d: { id: string; schedule: unknown; loadedKm: number }, lane: { originCityId: number; destCityId: number }, late: boolean, at: Date) {
  if (late || d.loadedKm < LANE_RECORDS.minKm || !(await featureFor(tx, userId, 'lane_records', at))) return null;
  const minutes = loadedRunMinutes(d.schedule as Segment[]);
  if (!minutes) return null;
  const month = recordMonth(at);
  const where = and(eq(laneRecords.month, month), eq(laneRecords.originCityId, lane.originCityId), eq(laneRecords.destCityId, lane.destCityId));
  const [prev] = await tx.select().from(laneRecords).where(where).for('update');
  if (prev && prev.minutes <= minutes) return null;
  const values = { month, ...lane, userId, deliveryId: d.id, minutes, km: d.loadedKm, setAt: at };
  if (prev) await tx.update(laneRecords).set(values).where(where);
  else await tx.insert(laneRecords).values(values).onConflictDoNothing();
  const name = await cityNames(tx, [lane.originCityId, lane.destCityId]);
  const route = `${name(lane.originCityId)} → ${name(lane.destCityId)}`;
  const time = `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
  // A first run on a lane is a record too, but only a beaten one is news.
  if (prev) {
    await notify(tx, userId, 'achievement', `Рекорд на линията ${route}`, `${time} с товар — най-бързият курс по нея този месец.`, '/game/leaderboards');
    if (prev.userId !== userId) {
      const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, userId));
      await notify(tx, prev.userId, 'info', `Рекордът ти на ${route} е подобрен`, `${me!.username} я взе за ${time}. Върни си го!`, '/game/leaderboards');
    }
  }
  return { minutes, beaten: !!prev };
}

/** This month's records (fastest first by lane length), with the holders. */
export async function laneRecordsView(db: DbOrTx, now = new Date(), limit = 30, userId?: string) {
  const o = sql<string>`(select name_bg from cities where id = ${laneRecords.originCityId})`;
  const t = sql<string>`(select name_bg from cities where id = ${laneRecords.destCityId})`;
  return db
    .select({ originCityId: laneRecords.originCityId, destCityId: laneRecords.destCityId, from: o, to: t, minutes: laneRecords.minutes, km: laneRecords.km, username: users.username, setAt: laneRecords.setAt })
    .from(laneRecords)
    .innerJoin(users, eq(users.id, laneRecords.userId))
    .where(userId ? and(eq(laneRecords.month, recordMonth(now)), eq(laneRecords.userId, userId)) : eq(laneRecords.month, recordMonth(now)))
    .orderBy(desc(laneRecords.km))
    .limit(limit);
}

// ── The company staff bus ─────────────────────────────────────────────────

/** Whether the member can still use the staff bus. */
export async function staffBusState(db: DbOrTx, userId: string, now = new Date()) {
  const m = await membershipOf(db, userId);
  if (!m || m.rank.isOwner) return null;
  const [row] = await db.select({ joinedAt: companyMembers.joinedAt, busUsedAt: companyMembers.busUsedAt, firstTripBonus: companyMembers.firstTripBonus }).from(companyMembers).where(eq(companyMembers.userId, userId));
  const until = new Date(row!.joinedAt.getTime() + STAFF_BUS.days * 86_400_000);
  return { hqCityId: m.company.hqCityId, company: m.company.name, available: !row!.busUsedAt && until > now, until, firstTripBonus: row!.firstTripBonus };
}

/** A new member's free truck (with its trailer) rides to the company base in a minute, free, once. */
export async function staffBus(db: Database, userId: string, vehicleId: string, now = new Date()) {
  if (!(await featureFor(db, userId, 'staff_bus', now))) fail('not_released', 'Това идва със следващото обновление.', 403);
  return db.transaction(async (tx) => {
    const m = await membershipOf(tx, userId, true);
    if (!m) fail('no_company', 'Не си член на компания.');
    if (m!.rank.isOwner) fail('owner', 'Фирменият автобус е за новите членове.');
    const [row] = await tx.select().from(companyMembers).where(eq(companyMembers.userId, userId)).for('update');
    if (row!.busUsedAt) fail('used', 'Фирменият автобус вече те докара.');
    if (row!.joinedAt.getTime() + STAFF_BUS.days * 86_400_000 <= now.getTime()) fail('too_late', `Автобусът е за първите ${STAFF_BUS.days} дни в компанията.`);
    const account = await companyForUser(tx, userId);
    const [v] = await tx.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, account.id), isNull(vehicles.soldAt))).for('update');
    if (!v) fail('vehicle_not_found', 'Превозното средство не е намерено.', 404);
    if (v!.status !== 'idle') fail('vehicle_busy', 'Камионът е на курс.');
    if (v!.movingUntil && v!.movingUntil > now) fail('moving', 'Камионът вече пътува.');
    const hq = m!.company.hqCityId;
    if (v!.cityId === hq) fail('same_city', 'Камионът вече е в града на базата.');
    const arrivesAt = new Date(now.getTime() + STAFF_BUS.rideMs);
    await tx.update(vehicles).set({ cityId: hq, movingUntil: arrivesAt }).where(eq(vehicles.id, v!.id));
    await tx.update(trailers).set({ cityId: hq }).where(eq(trailers.vehicleId, v!.id));
    await tx.update(companyMembers).set({ busUsedAt: now }).where(eq(companyMembers.userId, userId));
    return { arrivesAt, hqCityId: hq };
  });
}

/** The first trip as a member pays a bonus (personal account, before any treasury). */
export async function firstTripBonus(tx: Tx, userId: string, d: { id: string; companyId: string }, rewardCents: number, at: Date) {
  if (!(await featureFor(tx, userId, 'staff_bus', at))) return 0;
  const [row] = await tx.update(companyMembers).set({ firstTripBonus: false }).where(and(eq(companyMembers.userId, userId), eq(companyMembers.firstTripBonus, true))).returning({ companyId: companyMembers.companyId });
  if (!row) return 0;
  const bonus = Math.round(rewardCents * STAFF_BUS.firstTripShare);
  if (!bonus) return 0;
  const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, row.companyId));
  await post(tx, d.companyId, [{ category: 'staff_bus_bonus', amountCents: bonus, description: `Първи курс за „${org!.name}“`, idempotencyKey: `delivery:${d.id}:first-trip`, refType: 'delivery', refId: d.id }]);
  return bonus;
}

// ── The company anniversary ───────────────────────────────────────────────

/** Worker: a company's anniversary — a gift into the treasury, a badge for each member. */
export async function celebrateAnniversaries(db: Database, now = new Date()) {
  if (!featureLive('anniversary', now)) return 0;
  const orgs = await db.select({ id: organizations.id, name: organizations.name, foundedAt: organizations.foundedAt }).from(organizations);
  let n = 0;
  for (const o of orgs) {
    const years = anniversaryYears(o.foundedAt, now);
    if (!years) continue;
    await db.transaction(async (tx) => {
      const gift = anniversaryGiftCents(years);
      const applied = await postTreasury(tx, o.id, [{ category: 'anniversary', amountCents: gift, description: `${years} ${years === 1 ? 'година' : 'години'} „${o.name}“`, idempotencyKey: `anniversary:${o.id}:${years}` }]);
      if (!applied) return;
      n++;
      const members = await tx.select({ userId: companyMembers.userId }).from(companyMembers).where(eq(companyMembers.companyId, o.id));
      if (members.length) await tx.insert(userBadges).values(members.map((m) => ({ userId: m.userId, badge: ANNIVERSARY.badge, awardedAt: now }))).onConflictDoNothing();
      await addChronicle(tx, o.id, 'anniversary', `${years} ${years === 1 ? 'година' : 'години'} компанията`, now);
      await notifyMembers(tx, o.id, null, `Честит рожден ден, „${o.name}“! 🎂`, `${years} ${years === 1 ? 'година' : 'години'} заедно: ${money(gift)} в касата и значка „${BADGES[ANNIVERSARY.badge]!.label}“ за всеки член.`, '/game/company');
    });
  }
  return n;
}

// ── Driver of the month ───────────────────────────────────────────────────

/** The month before `now` (Sofia): its key ("2027-02") and bounds. */
function pastMonth(now: Date) {
  const start = periodWindow('monthly', new Date(periodWindow('monthly', now).endsAt.getTime() - 32 * 86_400_000)).endsAt;
  const before = new Date(start.getTime() - 86_400_000);
  const from = periodWindow('monthly', new Date(before.getTime() - 32 * 86_400_000)).endsAt;
  return { key: recordMonth(before), from, to: start };
}

/** Worker: once a month each company's member with the most trips is "Шофьор на месеца" (a badge, a prize if the owner set one). */
export async function awardDriversOfMonth(db: Database, now = new Date()) {
  if (!featureLive('driver_of_month', now)) return 0;
  const m = pastMonth(now);
  const jobKey = `driver-of-month:${m.key}`;
  const [done] = await db.select().from(jobState).where(eq(jobState.key, jobKey));
  if (done) return 0;
  const { rows } = await db.execute<{ organization_id: string; user_id: string; trips: number; tons: number }>(sql`
    select distinct on (m.company_id) m.company_id as organization_id, c.owner_id as user_id, count(*)::int as trips, coalesce(sum(k.weight_tons), 0)::float as tons
    from deliveries d join companies c on c.id = d.company_id join company_members m on m.user_id = c.owner_id join contracts k on k.id = d.contract_id
    where d.status = 'completed' and d.completed_at >= ${m.from} and d.completed_at < ${m.to}
    group by m.company_id, c.owner_id
    order by m.company_id, count(*) desc, sum(k.weight_tons) desc`);
  let n = 0;
  for (const r of rows) {
    if (r.trips < DRIVER_OF_MONTH.minTrips) continue;
    await db.transaction(async (tx) => {
      // The member's own account first, then the treasury (fixed lock order).
      const [account] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, r.user_id)).for('update');
      const [org] = await tx.select().from(organizations).where(eq(organizations.id, r.organization_id)).for('update');
      const [u] = await tx.select({ username: users.username }).from(users).where(eq(users.id, r.user_id));
      if (!account || !org || !u || org.driverOfMonth?.month === m.key) return;
      const prize = org.driverOfMonthPrizeCents > 0 && org.treasuryCents >= org.driverOfMonthPrizeCents ? org.driverOfMonthPrizeCents : 0;
      if (prize) {
        await post(tx, account.id, [{ category: 'member_bonus', amountCents: prize, description: `Шофьор на месеца в „${org.name}“`, idempotencyKey: `driver-month:${org.id}:${m.key}:in`, refType: 'company', refId: org.id }]);
        await postTreasury(tx, org.id, [{ category: 'member_bonus', amountCents: -prize, description: `Шофьор на месеца: ${u.username}`, idempotencyKey: `driver-month:${org.id}:${m.key}:out`, refType: 'user', refId: r.user_id }]);
      }
      await tx.update(organizations).set({ driverOfMonth: { userId: r.user_id, username: u.username, month: m.key, trips: r.trips, tons: Math.round(r.tons * 10) / 10 } }).where(eq(organizations.id, org.id));
      await tx.insert(userBadges).values({ userId: r.user_id, badge: DRIVER_OF_MONTH.badge, awardedAt: now }).onConflictDoNothing();
      await addChronicle(tx, org.id, 'driver', `Шофьор на месеца (${m.key}): ${u.username} — ${r.trips} курса`, now);
      await notifyMembers(tx, org.id, null, `Шофьор на месеца: ${u.username}`, `${r.trips} курса и ${Math.round(r.tons)} т за месеца${prize ? ` · премия ${money(prize)} от касата` : ''}.`, '/game/company');
      n++;
    });
  }
  await db.insert(jobState).values({ key: jobKey, value: { winners: n } }).onConflictDoNothing();
  return n;
}

/** The owner (right "Настройки") sets the monthly prize from the treasury. */
export async function setDriverOfMonthPrize(db: Database, actorId: string, cents: number, now = new Date()) {
  if (!(await featureFor(db, actorId, 'driver_of_month', now))) fail('not_released', 'Това идва със следващото обновление.', 403);
  if (!(DRIVER_OF_MONTH.prizes as readonly number[]).includes(cents)) fail('bad_prize', 'Невалидна премия.');
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_settings');
    await tx.update(organizations).set({ driverOfMonthPrizeCents: cents }).where(eq(organizations.id, actor.company.id));
  });
}

// ── The profile showcase ──────────────────────────────────────────────────

/** Picks up to three own trucks and three own badges for the public profile. */
export async function setShowcase(db: Database, userId: string, input: { trucks: string[]; badges: string[] }, now = new Date()) {
  if (!(await featureFor(db, userId, 'profile_showcase', now))) fail('not_released', 'Това идва със следващото обновление.', 403);
  const trucks = [...new Set(input.trucks)].slice(0, SHOWCASE.trucks);
  const badges = [...new Set(input.badges)].slice(0, SHOWCASE.badges);
  const account = await companyForUser(db, userId);
  if (trucks.length) {
    const own = await db.select({ id: vehicles.id }).from(vehicles).where(and(eq(vehicles.companyId, account.id), isNull(vehicles.soldAt), inArray(vehicles.id, trucks)));
    if (own.length !== trucks.length) fail('not_yours', 'Може да показваш само свои камиони.');
  }
  if (badges.length) {
    const own = new Set((await badgesOf(db, userId)).map((b) => b.id));
    if (badges.some((b) => !own.has(b))) fail('not_yours', 'Може да показваш само свои значки.');
  }
  await db.update(users).set({ showcase: { trucks, badges } }).where(eq(users.id, userId));
  return { trucks, badges };
}

/** The showcase of a player: the trucks (as drawn in the garage) and the badges, still owned. */
export async function showcaseOf(db: DbOrTx, userId: string) {
  const [u] = await db.select({ showcase: users.showcase }).from(users).where(eq(users.id, userId));
  const [account] = await db.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
  if (!u || !account) return { trucks: [], badges: [] };
  const fleet = u.showcase.trucks.length ? (await fleetView(db, account.id)).vehicles : [];
  const owned = await badgesOf(db, userId);
  return {
    trucks: u.showcase.trucks.map((id) => fleet.find((v) => v.id === id)).filter((v): v is NonNullable<typeof v> => !!v).map((v) => ({
      id: v.id,
      plate: v.plate,
      name: `${v.model.brand} ${v.model.name}`,
      truck: { modelId: v.modelId, trailerModelId: v.trailer?.modelId ?? null, color: v.color, livery: v.livery, cosmetics: v.cosmetics, trailerUpgrades: v.trailer?.upgrades, trailerLogo: v.trailer?.logo, trailerCosmetics: v.trailer?.cosmetics },
    })),
    badges: u.showcase.badges.map((id) => owned.find((b) => b.id === id)).filter((b): b is NonNullable<typeof b> => !!b).map((b) => ({ id: b.id, label: b.label, description: b.description })),
  };
}

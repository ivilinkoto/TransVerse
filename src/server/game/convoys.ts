import { and, asc, desc, eq, gt, gte, inArray, lte, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CARGO, CARGO_TYPES, type CargoType } from '@/lib/game/cargo';
import { CONVOYS, CONVOY_ROLES, convoyShare, leaderTier, nextWeeklyDeparture, stretchSchedule, type ConvoyRole } from '@/lib/game/convoys';
import { rewardCents } from '@/lib/game/economy';
import { featureLive } from '@/lib/game/features';
import { BADGES } from '@/lib/game/halloween';
import { contractWindowMinutes, type Segment } from '@/lib/game/schedule';
import { sofiaDate } from '@/lib/game/together';
import { rateLimit } from '@/server/auth/rate-limit';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companyMembers, contracts, convoyMembers, convoyMessages, convoys, convoyStats, deliveries, organizations, routes, userBadges, users, vehicles } from '@/server/db/schema';
import { appUrl } from '@/server/discord/config';
import { announce } from '@/server/discord/outbox';
import { featureFor } from '@/server/features';
import { getRoute } from '@/server/geo/route-service';
import type { RoutingProvider } from '@/server/geo/routing';
import { companyForUser } from './company';
import { acceptContract } from './deliveries';
import { fail, GameError } from './errors';
import { post } from './finance';
import { can, membershipOf } from './membership';
import { assertNotMuted } from './moderation';
import { notify } from './notify';
import { circleOf } from './world-map';
import { t } from '@/i18n/t';

const MIN = 60_000;

export const convoySchema = z.object({
  kind: z.enum(['personal', 'company']).default('personal'),
  access: z.enum(['open', 'friends', 'link']).default('open'),
  originCityId: z.coerce.number().int().positive(),
  destCityId: z.coerce.number().int().positive(),
  /** Minutes from now. */
  departInMin: z.coerce.number().int().min(CONVOYS.departMinMin).max(CONVOYS.departMaxHours * 60),
  seats: z.coerce.number().int().min(CONVOYS.seats.min).max(CONVOYS.seats.max),
  minLevel: z.coerce.number().int().min(1).max(100).default(1),
  sharedCargo: z.enum(CARGO_TYPES).nullable().optional(),
  sharedTons: z.coerce.number().min(CONVOYS.sharedTons.min).max(CONVOYS.sharedTons.max).nullable().optional(),
  title: z.string().trim().max(60).optional(),
});

async function statsOf(db: DbOrTx, userId: string) {
  const [s] = await db.select().from(convoyStats).where(eq(convoyStats.userId, userId));
  return s ?? { userId, convoys: 0, onTime: 0, streak: 0, led: 0, ledOnTime: 0, bonusesToday: null };
}

/** A leader opens a convoy (personal, or for their company). */
export async function createConvoy(db: Database, userId: string, raw: z.input<typeof convoySchema>, now = new Date(), provider?: RoutingProvider) {
  if (!(await featureFor(db, userId, 'convoy_lobby', now))) fail('not_released', t('Конвоите идват с обновление 1.10.'), 403);
  const input = convoySchema.parse(raw);
  if (input.originCityId === input.destCityId) fail('same_city', t('Избери различни градове.'));
  const [u] = await db.select({ level: users.level }).from(users).where(eq(users.id, userId));
  if ((u?.level ?? 1) < CONVOYS.minLevel) fail('level_required', t('Конвой се води от ниво {0}.', CONVOYS.minLevel), 403);
  const tier = leaderTier((await statsOf(db, userId)).led);
  if (input.seats > tier.seats) fail('too_many_seats', t('Като „{0}“ водиш до {1} камиона. Повече места идват с повече водени конвои.', tier.name, tier.seats));
  let organizationId: string | null = null;
  if (input.kind === 'company') {
    const m = await membershipOf(db, userId);
    if (!m) fail('not_member', t('Фирмен конвой е за членове на компания.'), 403);
    organizationId = m!.company.id;
  }
  const [mine] = await db.select({ n: sql<number>`count(*)::int` }).from(convoys).where(and(eq(convoys.leaderId, userId), eq(convoys.status, 'open')));
  if ((mine?.n ?? 0) >= 2) fail('too_many', t('Можеш да водиш до 2 отворени конвоя наведнъж.'));
  if ((input.sharedCargo && !input.sharedTons) || (!input.sharedCargo && input.sharedTons)) fail('bad_shared', t('За общ товар избери вид и тонове.'));
  const ends = await db.select({ id: cities.id }).from(cities).where(inArray(cities.id, [input.originCityId, input.destCityId]));
  if (ends.length < 2) fail('not_found', t('Няма такъв град.'), 404);
  const route = await getRoute(db, input.originCityId, input.destCityId, 'truck', provider);
  const [row] = await db
    .insert(convoys)
    .values({
      kind: input.kind,
      access: input.kind === 'company' ? 'open' : input.access,
      organizationId,
      leaderId: userId,
      title: input.title || null,
      originCityId: input.originCityId,
      destCityId: input.destCityId,
      routeId: route.id,
      departAt: new Date(now.getTime() + input.departInMin * MIN),
      seats: input.seats,
      minLevel: input.minLevel,
      sharedCargo: input.sharedCargo ?? null,
      sharedTons: input.sharedTons ?? null,
      createdAt: now,
    })
    .returning();
  await announceConvoyOpen(db, row!, now);
  return { id: row!.id };
}

async function cityNames(db: DbOrTx, ids: number[]) {
  const rows = await db.select({ id: cities.id, nameBg: cities.nameBg, countryCode: cities.countryCode }).from(cities).where(inArray(cities.id, ids));
  return (id: number) => rows.find((c) => c.id === id)?.nameBg ?? '';
}

async function announceConvoyOpen(db: DbOrTx, c: typeof convoys.$inferSelect, now: Date) {
  if (!featureLive('discord_bot', now) || c.kind === 'company' || c.access !== 'open') return;
  const name = await cityNames(db, [c.originCityId, c.destCityId]);
  const [leader] = c.leaderId ? await db.select({ username: users.username }).from(users).where(eq(users.id, c.leaderId)) : [];
  await announce(db, `convoy-open:${c.id}`, 'convoys', () => ({
    embeds: [{
      title: `🚚 ${c.kind === 'official' ? t('Голям конвой на TransVerse') : t('Конвой')}: ${name(c.originCityId)} → ${name(c.destCityId)}`,
      url: `${appUrl()}/game/convoys/${c.id}`,
      color: 0x22d3ee,
      description: t('{0}Тръгване <t:{1}:R> · {2} места{3}. Включи се в играта.', leader ? t('Води **{0}**. ', leader.username) : '', Math.floor(c.departAt.getTime() / 1000), c.seats, c.sharedCargo ? t(' · общ товар {0}', CARGO[c.sharedCargo as CargoType]?.label ?? '') : ''),
      footer: { text: t('TransVerse · игрови данни') },
    }],
  }), now);
}

/** Can this player see / join this convoy? */
async function mayJoin(db: DbOrTx, userId: string, c: typeof convoys.$inferSelect) {
  if (c.leaderId === userId || c.kind === 'official') return true;
  if (c.kind === 'company') return (await membershipOf(db, userId))?.company.id === c.organizationId;
  if (c.access === 'friends') return c.leaderId ? (await circleOf(db, c.leaderId)).friends.has(userId) : false;
  return true;
}

/** A truck joins: its own load on the lane, or a part of the shared load. */
export async function joinConvoy(db: Database, userId: string, convoyId: string, pick: { vehicleId: string; contractId?: string | null; role?: ConvoyRole }, now = new Date()) {
  if (!(await featureFor(db, userId, 'convoy_lobby', now))) fail('not_released', t('Конвоите идват с обновление 1.10.'), 403);
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(convoys).where(eq(convoys.id, convoyId)).for('update');
    if (!c) fail('not_found', t('Няма такъв конвой.'), 404);
    if (c!.status !== 'open' || c!.departAt.getTime() - now.getTime() < CONVOYS.joinUntilMin * MIN) fail('closed', t('Конвоят вече тръгва или е тръгнал.'));
    if (!(await mayJoin(tx, userId, c!))) fail('forbidden', c!.kind === 'company' ? t('Конвоят е само за членовете на компанията.') : t('Конвоят е само за приятелите на водача.'), 403);
    const [u] = await tx.select({ level: users.level }).from(users).where(eq(users.id, userId));
    if ((u?.level ?? 1) < c!.minLevel) fail('level_required', t('Конвоят приема от ниво {0}.', c!.minLevel));
    const members = await tx.select().from(convoyMembers).where(and(eq(convoyMembers.convoyId, c!.id), eq(convoyMembers.status, 'ready')));
    if (members.some((m) => m.userId === userId)) fail('already', t('Вече си в този конвой.'));
    if (members.length >= c!.seats) fail('full', t('Конвоят е пълен.'));
    const account = await companyForUser(tx, userId);
    const [v] = await tx.select().from(vehicles).where(and(eq(vehicles.id, pick.vehicleId), eq(vehicles.companyId, account.id)));
    if (!v) fail('not_found', t('Няма такъв камион.'), 404);
    if (v!.cityId !== c!.originCityId) fail('wrong_city', t('Камионът трябва да е в града на тръгване.'));
    if (v!.status !== 'idle') fail('vehicle_busy', t('Камионът е на курс.'));
    const [busy] = await tx.select({ id: convoyMembers.convoyId }).from(convoyMembers).innerJoin(convoys, eq(convoys.id, convoyMembers.convoyId)).where(and(eq(convoyMembers.vehicleId, v!.id), eq(convoyMembers.status, 'ready'), eq(convoys.status, 'open')));
    if (busy) fail('vehicle_in_convoy', t('Камионът вече чака друг конвой.'));
    let contractId = pick.contractId ?? null;
    const hold = new Date(c!.departAt.getTime() + 10 * MIN);
    if (contractId) {
      const [load] = await tx.select().from(contracts).where(eq(contracts.id, contractId)).for('update');
      if (!load || load.status !== 'open' || load.expiresAt <= now) fail('contract_unavailable', t('Товарът вече не е свободен.'), 409);
      if (load!.originCityId !== c!.originCityId || load!.destCityId !== c!.destCityId) fail('wrong_lane', t('Товарът трябва да е по линията на конвоя.'));
      if (load!.urgent || load!.shady || load!.convoyId || load!.tenderId || load!.rallyId) fail('wrong_load', t('Този товар не става за конвой.'));
      if (load!.reservedUntil && load!.reservedUntil > now && load!.reservedByCompanyId !== account.id) fail('reserved', t('Товарът е запазен от друг играч.'), 409);
      await tx.update(contracts).set({ reservedByCompanyId: account.id, reservedUntil: hold }).where(eq(contracts.id, load!.id));
    } else {
      if (!c!.sharedCargo || !c!.sharedTons) fail('no_shared', t('Този конвой няма общ товар — избери свой товар по линията.'));
      const [route] = await tx.select({ distanceKm: routes.distanceKm }).from(routes).where(eq(routes.id, c!.routeId));
      const cargo = c!.sharedCargo as CargoType;
      const [part] = await tx
        .insert(contracts)
        .values({
          shipper: c!.kind === 'official' ? 'TransVerse' : 'Общ товар на конвоя',
          goods: CARGO[cargo].goods[0] ?? CARGO[cargo].label,
          cargoType: cargo,
          weightTons: c!.sharedTons!,
          originCityId: c!.originCityId,
          destCityId: c!.destCityId,
          routeId: c!.routeId,
          distanceKm: route!.distanceKm,
          rewardCents: rewardCents(cargo, c!.sharedTons!, route!.distanceKm, CONVOYS.sharedMultiplier),
          windowMinutes: contractWindowMinutes(route!.distanceKm),
          minLevel: CARGO[cargo].minLevel,
          convoyId: c!.id,
          reservedByCompanyId: account.id,
          reservedUntil: hold,
          createdBy: userId,
          expiresAt: hold,
        })
        .returning({ id: contracts.id });
      contractId = part!.id;
    }
    // Roles: the leader leads; the tail and the scout are one each.
    let role: ConvoyRole = c!.leaderId === userId ? 'leader' : 'member';
    if (role !== 'leader' && (pick.role === 'tail' || pick.role === 'scout')) {
      if (members.some((m) => m.role === pick.role)) fail('role_taken', t('Ролята „{0}“ е заета.', CONVOY_ROLES[pick.role].label));
      role = pick.role;
    }
    await tx
      .insert(convoyMembers)
      .values({ convoyId: c!.id, userId, vehicleId: v!.id, contractId: contractId!, role, joinedAt: now })
      .onConflictDoUpdate({ target: [convoyMembers.convoyId, convoyMembers.userId], set: { vehicleId: v!.id, contractId: contractId!, role, status: 'ready', reason: null, joinedAt: now } });
    if (c!.leaderId && c!.leaderId !== userId) {
      const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, userId));
      await notify(tx, c!.leaderId, 'info', () => t('Нов камион в конвоя'), () => t('{0} се включи ({1} / {2}).', me?.username ?? t('Играч'), members.length + 1, c!.seats), `/game/convoys/${c!.id}`);
    }
    return { joined: true, role };
  });
}

async function release(tx: Tx, m: { contractId: string; userId: string }) {
  // A shared part goes away; an own load is free again.
  await tx.update(contracts).set({ status: 'expired' }).where(and(eq(contracts.id, m.contractId), sql`${contracts.convoyId} is not null`, eq(contracts.status, 'open')));
  const account = await companyForUser(tx, m.userId);
  await tx.update(contracts).set({ reservedByCompanyId: null, reservedUntil: null }).where(and(eq(contracts.id, m.contractId), eq(contracts.reservedByCompanyId, account.id)));
}

export async function leaveConvoy(db: Database, userId: string, convoyId: string) {
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(convoyMembers).innerJoin(convoys, eq(convoys.id, convoyMembers.convoyId)).where(and(eq(convoyMembers.convoyId, convoyId), eq(convoyMembers.userId, userId), eq(convoyMembers.status, 'ready'), eq(convoys.status, 'open')));
    if (!m) fail('not_found', t('Не си в този конвой.'), 404);
    await tx.update(convoyMembers).set({ status: 'left' }).where(and(eq(convoyMembers.convoyId, convoyId), eq(convoyMembers.userId, userId)));
    await release(tx, m!.convoy_members);
    return { left: true };
  });
}

/** The leader (or, for a company convoy, a manager) calls it off before it leaves. */
export async function cancelConvoy(db: Database, userId: string, convoyId: string) {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(convoys).where(and(eq(convoys.id, convoyId), eq(convoys.status, 'open'))).for('update');
    if (!c) fail('not_found', t('Няма такъв отворен конвой.'), 404);
    const m = c!.kind === 'company' ? await membershipOf(tx, userId) : null;
    const manager = !!m && m.company.id === c!.organizationId && (m.rank.isOwner || can(m.rank, 'manage_tenders'));
    if (c!.leaderId !== userId && !manager) fail('forbidden', t('Само водачът отменя конвоя.'), 403);
    await tx.update(convoys).set({ status: 'cancelled' }).where(eq(convoys.id, c!.id));
    const members = await tx.select().from(convoyMembers).where(and(eq(convoyMembers.convoyId, c!.id), eq(convoyMembers.status, 'ready')));
    for (const mem of members) {
      await tx.update(convoyMembers).set({ status: 'left', reason: 'Конвоят е отменен.' }).where(and(eq(convoyMembers.convoyId, c!.id), eq(convoyMembers.userId, mem.userId)));
      await release(tx, mem);
      if (mem.userId !== userId) await notify(tx, mem.userId, 'info', () => t('Конвоят е отменен'), () => t('Водачът отмени конвоя. Товарът ти е свободен.'), '/game/convoys');
    }
    return { cancelled: true };
  });
}

export async function postConvoyMessage(db: Database, userId: string, convoyId: string, raw: string) {
  const body = z.string().trim().min(1, t('Напиши съобщение.')).max(CONVOYS.messageMax).parse(raw);
  await assertNotMuted(db, userId);
  await rateLimit(db, `convoy-chat:${userId}`, 10, 60);
  const [c] = await db.select().from(convoys).where(eq(convoys.id, convoyId));
  if (!c) fail('not_found', t('Няма такъв конвой.'), 404);
  const [m] = await db.select({ userId: convoyMembers.userId }).from(convoyMembers).where(and(eq(convoyMembers.convoyId, convoyId), eq(convoyMembers.userId, userId)));
  if (!m && c!.leaderId !== userId) fail('forbidden', t('Пишат само камионите в конвоя.'), 403);
  const [row] = await db.insert(convoyMessages).values({ convoyId, userId, body }).returning({ id: convoyMessages.id });
  return { id: row!.id };
}

/**
 * Worker, every minute: convoys whose time has come leave. Every ready truck
 * takes its load (as an ordinary acceptance); the column then drives at the
 * slowest truck's pace — all arrive together, with no road incidents, and
 * each one's deadline moves with the column.
 */
export async function departConvoys(db: Database, now = new Date()) {
  const due = await db.select().from(convoys).where(and(eq(convoys.status, 'open'), lte(convoys.departAt, now)));
  let left = 0;
  for (const c of due) {
    const [claimed] = await db.update(convoys).set({ status: 'departing' }).where(and(eq(convoys.id, c.id), eq(convoys.status, 'open'))).returning();
    if (!claimed) continue;
    const members = await db.select().from(convoyMembers).where(and(eq(convoyMembers.convoyId, c.id), eq(convoyMembers.status, 'ready')));
    const gone: { userId: string; deliveryId: string }[] = [];
    for (const m of members) {
      try {
        // The column forms in the start city: a truck elsewhere stays behind.
        const [v] = await db.select({ cityId: vehicles.cityId }).from(vehicles).where(eq(vehicles.id, m.vehicleId));
        if (v?.cityId !== c.originCityId) fail('wrong_city', t('Камионът не беше в града на тръгване.'));
        const d = await acceptContract(db, m.userId, m.contractId, m.vehicleId, now);
        await db.update(convoyMembers).set({ status: 'departed', deliveryId: d.id }).where(and(eq(convoyMembers.convoyId, c.id), eq(convoyMembers.userId, m.userId)));
        gone.push({ userId: m.userId, deliveryId: d.id });
      } catch (error) {
        const reason = error instanceof GameError ? error.message : t('Камионът не можа да тръгне.');
        await db.transaction(async (tx) => {
          await tx.update(convoyMembers).set({ status: 'dropped', reason }).where(and(eq(convoyMembers.convoyId, c.id), eq(convoyMembers.userId, m.userId)));
          await release(tx, m);
          await notify(tx, m.userId, 'warning', () => t('Камионът ти не тръгна с конвоя'), reason, `/game/convoys/${c.id}`);
        });
      }
    }
    await db.transaction(async (tx) => {
      const rows = gone.length ? await tx.select().from(deliveries).where(inArray(deliveries.id, gone.map((g) => g.deliveryId))).for('update') : [];
      const end = Math.max(0, ...rows.map((r) => r.etaAt.getTime()));
      for (const r of rows) {
        const shift = end - r.etaAt.getTime();
        await tx
          .update(deliveries)
          .set({ organizedConvoyId: c.id, schedule: stretchSchedule(r.schedule as Segment[], r.startedAt.getTime(), end), etaAt: new Date(end), deadlineAt: new Date(r.deadlineAt.getTime() + shift), roadEvents: [], nextEventAt: null, choice: null })
          .where(eq(deliveries.id, r.id));
      }
      const allOnTime = rows.length > 0 && rows.every((r) => r.etaAt.getTime() <= r.deadlineAt.getTime());
      await tx.update(convoys).set({ status: rows.length ? 'departed' : 'cancelled', trucks: rows.length, allOnTime, arrivesAt: rows.length ? new Date(end) : null }).where(eq(convoys.id, c.id));
      for (const g of gone) await notify(tx, g.userId, 'success', () => t('Конвоят тръгна ({0} камиона) 🚚', rows.length), () => rows.length >= CONVOYS.minTrucks ? t('Колоната кара заедно — пристигате едновременно.') : t('Само твоят камион тръгна — без конвоен бонус този път.'), `/game/convoys/${c.id}`);
      if (rows.length >= CONVOYS.minTrucks && featureLive('discord_bot', now) && (c.kind === 'official' || (c.kind === 'personal' && c.access === 'open'))) {
        const name = await cityNames(tx, [c.originCityId, c.destCityId]);
        await announce(tx, `convoy-left:${c.id}`, 'convoys', () => ({ embeds: [{ title: t('🚚 Колона от {0} камиона тръгна: {1} → {2}', rows.length, name(c.originCityId), name(c.destCityId)), url: `${appUrl()}/game/convoys/${c.id}`, color: 0x22d3ee, footer: { text: t('TransVerse · игрови данни') } }] }), now);
      }
    });
    left++;
  }
  return left;
}

/** Does this delivery drive in a company convoy (no contribution, more company XP)? */
export async function companyConvoyOf(tx: DbOrTx, d: { organizedConvoyId: string | null }) {
  if (!d.organizedConvoyId) return false;
  const [c] = await tx.select({ kind: convoys.kind, trucks: convoys.trucks }).from(convoys).where(eq(convoys.id, d.organizedConvoyId));
  return c?.kind === 'company' && c.trucks >= CONVOYS.minTrucks;
}

async function badge(tx: Tx, userId: string, id: string, at: Date) {
  const [got] = await tx.insert(userBadges).values({ userId, badge: id, awardedAt: at }).onConflictDoNothing().returning();
  if (got) await notify(tx, userId, 'achievement', () => t('Значка: {0}', BADGES[id]?.label ?? id), BADGES[id]?.description ?? '', '/game/convoys');
}

/**
 * On arrival of a convoy truck: the bonus, the record, the challenges.
 * Only different players from level 3, at most 3 bonuses a day each.
 */
export async function settleConvoyTruck(tx: Tx, userId: string, d: { id: string; companyId: string; organizedConvoyId: string | null }, f: { late: boolean; rewardCents: number }, at: Date) {
  if (!d.organizedConvoyId) return 0;
  const [c] = await tx.select().from(convoys).where(eq(convoys.id, d.organizedConvoyId));
  if (!c) return 0;
  const [m] = await tx.select().from(convoyMembers).where(and(eq(convoyMembers.convoyId, c.id), eq(convoyMembers.userId, userId)));
  const role = (m?.role ?? 'member') as ConvoyRole;
  const [u] = await tx.select({ level: users.level }).from(users).where(eq(users.id, userId));
  const s = await statsOf(tx, userId);
  const today = sofiaDate(at);
  const [day, n] = (s.bonusesToday ?? '').split(':');
  const used = day === today ? Number(n) || 0 : 0;
  const share = (u?.level ?? 1) >= CONVOYS.minLevel && used < CONVOYS.bonusesPerDay ? convoyShare({ trucks: c.trucks, onTime: !f.late, allOnTime: !!c.allOnTime, role }) : 0;
  const bonus = Math.round(f.rewardCents * share);
  if (bonus) await post(tx, d.companyId, [{ category: 'convoy_bonus', amountCents: bonus, description: t('Конвой от {0} камиона{1}{2}', c.trucks, c.allOnTime ? t(', всички навреме') : '', role !== 'member' ? ` · ${CONVOY_ROLES[role].label}` : ''), idempotencyKey: `delivery:${d.id}:organized-convoy`, refType: 'delivery', refId: d.id }]);
  if (c.trucks < CONVOYS.minTrucks) return bonus;
  const leading = role === 'leader';
  const streak = f.late ? 0 : s.streak + 1;
  await tx
    .insert(convoyStats)
    .values({ userId, convoys: 1, onTime: f.late ? 0 : 1, streak, led: leading ? 1 : 0, ledOnTime: leading && !f.late ? 1 : 0, bonusesToday: `${today}:${used + (bonus ? 1 : 0)}` })
    .onConflictDoUpdate({
      target: convoyStats.userId,
      set: {
        convoys: sql`${convoyStats.convoys} + 1`,
        onTime: sql`${convoyStats.onTime} + ${f.late ? 0 : 1}`,
        streak,
        led: sql`${convoyStats.led} + ${leading ? 1 : 0}`,
        ledOnTime: sql`${convoyStats.ledOnTime} + ${leading && !f.late ? 1 : 0}`,
        bonusesToday: `${today}:${used + (bonus ? 1 : 0)}`,
      },
    });
  if (streak >= CONVOYS.streakBadge) await badge(tx, userId, 'convoy-streak', at);
  const [route] = await tx.select({ countries: routes.countries }).from(routes).where(eq(routes.id, c.routeId));
  if (!f.late && (route?.countries.length ?? 0) >= CONVOYS.countriesBadge) await badge(tx, userId, 'convoy-europe', at);
  if (leading && !f.late && c.trucks >= 5) await badge(tx, userId, 'convoy-leader', at);
  if (leading && s.led + 1 >= 50) await badge(tx, userId, 'legend-leader', at);
  // The column has arrived (once).
  const [arrived] = await tx.update(convoys).set({ status: 'arrived' }).where(and(eq(convoys.id, c.id), eq(convoys.status, 'departed'))).returning();
  if (arrived && featureLive('discord_bot', at) && (c.kind === 'official' || (c.kind === 'personal' && c.access === 'open'))) {
    const name = await cityNames(tx, [c.originCityId, c.destCityId]);
    await announce(tx, `convoy-arrived:${c.id}`, 'convoys', () => ({ embeds: [{ title: t('🏁 Колоната пристигна: {0} → {1}', name(c.originCityId), name(c.destCityId)), description: t('{0} камиона{1}.', c.trucks, c.allOnTime ? t(', всички навреме') : ''), color: 0x22d3ee, footer: { text: t('TransVerse · игрови данни') } }] }), at);
  }
  return bonus;
}

/** Worker: the game's own big convoy each Sunday at 20:00 (opens 30 h before). */
export async function ensureWeeklyConvoy(db: Database, now = new Date(), provider?: RoutingProvider) {
  if (!featureLive('weekly_convoy', now)) return null;
  const departAt = nextWeeklyDeparture(now);
  if (departAt.getTime() - now.getTime() > CONVOYS.weekly.openHours * 3_600_000) return null;
  const [exists] = await db.select({ id: convoys.id }).from(convoys).where(and(eq(convoys.kind, 'official'), eq(convoys.departAt, departAt)));
  if (exists) return null;
  const big = await db.select({ id: cities.id, lat: cities.lat, lon: cities.lon }).from(cities).where(and(eq(cities.countryCode, 'BG'), gte(cities.population, 100_000))).orderBy(desc(cities.population)).limit(8);
  if (big.length < 2) return null;
  // A lane that changes every week, the same for everyone.
  const week = Math.floor(departAt.getTime() / (7 * 86_400_000));
  const a = big[week % big.length]!;
  const b = big.filter((x) => x.id !== a.id && Math.abs(x.lat - a.lat) + Math.abs(x.lon - a.lon) > 1.2)[week % 3] ?? big.find((x) => x.id !== a.id)!;
  const route = await getRoute(db, a.id, b.id, 'truck', provider);
  const [row] = await db
    .insert(convoys)
    .values({ kind: 'official', access: 'open', title: 'Неделен голям конвой', originCityId: a.id, destCityId: b.id, routeId: route.id, departAt, seats: CONVOYS.weekly.seats, minLevel: 1, sharedCargo: 'pallets', sharedTons: 10, createdAt: now })
    .returning();
  await announceConvoyOpen(db, row!, now);
  return row!.id;
}

/** The convoys a player can see: the game's, the open ones, friends', the company's and their own. */
export async function convoysFor(db: DbOrTx, userId: string, now: Date) {
  const m = await membershipOf(db, userId);
  const { friends } = await circleOf(db, userId);
  const leaders = [...friends, userId];
  const rows = await db
    .select()
    .from(convoys)
    .where(
      and(
        or(eq(convoys.status, 'open'), and(eq(convoys.status, 'departed'), gt(convoys.arrivesAt, now))),
        or(
          eq(convoys.kind, 'official'),
          and(eq(convoys.kind, 'personal'), or(eq(convoys.access, 'open'), and(eq(convoys.access, 'friends'), inArray(convoys.leaderId, leaders)), eq(convoys.leaderId, userId))),
          m ? and(eq(convoys.kind, 'company'), eq(convoys.organizationId, m.company.id)) : sql`false`,
          sql`${convoys.id} in (select convoy_id from convoy_members where user_id = ${userId})`,
        ),
      ),
    )
    .orderBy(asc(convoys.departAt))
    .limit(60);
  return decorate(db, rows, userId);
}

async function decorate(db: DbOrTx, rows: (typeof convoys.$inferSelect)[], userId: string) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const members = await db.select({ convoyId: convoyMembers.convoyId, userId: convoyMembers.userId, username: users.username, role: convoyMembers.role, status: convoyMembers.status, reason: convoyMembers.reason, vehicleId: convoyMembers.vehicleId, plate: vehicles.plate, modelId: vehicles.modelId }).from(convoyMembers).innerJoin(users, eq(users.id, convoyMembers.userId)).leftJoin(vehicles, eq(vehicles.id, convoyMembers.vehicleId)).where(inArray(convoyMembers.convoyId, ids));
  const name = await cityNames(db, [...new Set(rows.flatMap((r) => [r.originCityId, r.destCityId]))]);
  const leaderIds = [...new Set(rows.map((r) => r.leaderId).filter((x): x is string => !!x))];
  const leaders = leaderIds.length ? await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, leaderIds)) : [];
  const orgIds = [...new Set(rows.map((r) => r.organizationId).filter((x): x is string => !!x))];
  const orgs = orgIds.length ? await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, orgIds)) : [];
  return rows.map((r) => {
    const ms = members.filter((x) => x.convoyId === r.id && x.status !== 'left');
    return {
      ...r,
      from: name(r.originCityId),
      to: name(r.destCityId),
      leader: leaders.find((l) => l.id === r.leaderId)?.username ?? null,
      company: orgs.find((o) => o.id === r.organizationId)?.name ?? null,
      members: ms,
      ready: ms.filter((x) => x.status === 'ready' || x.status === 'departed').length,
      mine: ms.find((x) => x.userId === userId) ?? null,
    };
  });
}

export async function convoyDetail(db: DbOrTx, userId: string, id: string) {
  const [c] = await db.select().from(convoys).where(eq(convoys.id, id));
  if (!c || !(await mayJoin(db, userId, c))) return null;
  const [view] = await decorate(db, [c], userId);
  const messages = await db.select({ id: convoyMessages.id, body: convoyMessages.body, username: users.username, createdAt: convoyMessages.createdAt }).from(convoyMessages).innerJoin(users, eq(users.id, convoyMessages.userId)).where(eq(convoyMessages.convoyId, id)).orderBy(desc(convoyMessages.createdAt)).limit(40);
  // The official convoy: companies by the number of their trucks.
  const byCompany = c.kind === 'official'
    ? await db.select({ name: organizations.name, trucks: sql<number>`count(*)::int` }).from(convoyMembers).innerJoin(companyMembers, eq(companyMembers.userId, convoyMembers.userId)).innerJoin(organizations, eq(organizations.id, companyMembers.companyId)).where(and(eq(convoyMembers.convoyId, id), ne(convoyMembers.status, 'left'), ne(convoyMembers.status, 'dropped'))).groupBy(organizations.name).orderBy(desc(sql`count(*)`)).limit(10)
    : [];
  return { ...view!, messages: messages.reverse(), byCompany };
}

/** The best leaders. */
export async function topLeaders(db: DbOrTx, limit = 10) {
  return db.select({ username: users.username, led: convoyStats.led, ledOnTime: convoyStats.ledOnTime }).from(convoyStats).innerJoin(users, eq(users.id, convoyStats.userId)).where(gt(convoyStats.led, 0)).orderBy(desc(convoyStats.led), desc(convoyStats.ledOnTime)).limit(limit);
}

export async function myConvoyStats(db: DbOrTx, userId: string) {
  const s = await statsOf(db, userId);
  return { ...s, tier: leaderTier(s.led) };
}

/** Loads on a convoy's lane the player could take with it. */
export async function laneLoads(db: DbOrTx, c: { originCityId: number; destCityId: number }, now: Date) {
  return db
    .select({ id: contracts.id, goods: contracts.goods, cargoType: contracts.cargoType, weightTons: contracts.weightTons, rewardCents: contracts.rewardCents, minLevel: contracts.minLevel })
    .from(contracts)
    .where(and(eq(contracts.originCityId, c.originCityId), eq(contracts.destCityId, c.destCityId), eq(contracts.status, 'open'), gt(contracts.expiresAt, now), eq(contracts.urgent, false), eq(contracts.shady, false), sql`${contracts.convoyId} is null`, sql`${contracts.tenderId} is null`, sql`(${contracts.reservedUntil} is null or ${contracts.reservedUntil} < ${now})`))
    .orderBy(desc(contracts.rewardCents))
    .limit(20);
}


/** Open public convoys with a free seat (Discord /конвой-голям). */
export async function openConvoysList(db: DbOrTx, now: Date, limit = 10) {
  const rows = await db
    .select({ id: convoys.id, originCityId: convoys.originCityId, destCityId: convoys.destCityId, seats: convoys.seats, departAt: convoys.departAt, taken: sql<number>`(select count(*)::int from convoy_members m where m.convoy_id = ${convoys.id} and m.status = 'ready')` })
    .from(convoys)
    .where(and(eq(convoys.status, 'open'), gt(convoys.departAt, now), or(eq(convoys.kind, 'official'), and(eq(convoys.kind, 'personal'), eq(convoys.access, 'open')))))
    .orderBy(asc(convoys.departAt))
    .limit(limit);
  const name = rows.length ? await cityNames(db, [...new Set(rows.flatMap((r) => [r.originCityId, r.destCityId]))]) : () => '';
  return rows.filter((r) => r.taken < r.seats).map((r) => ({ ...r, from: name(r.originCityId), to: name(r.destCityId) }));
}

import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CARGO_TYPES, type CargoType } from '@/lib/game/cargo';
import {
  autoTarget,
  AUTO_EVENT_HOURS,
  DEFAULT_REWARDS,
  EVENT_METRIC_INFO,
  ALL_EVENT_TEMPLATES,
  EVENT_METRICS,
  eventIncrement,
  goalText,
  MAX_TOP_PLACES,
  nextAutoWindow,
  pickTemplate,
  rewardFor,
  rewardText,
  type EventMetric,
  type EventRewards,
} from '@/lib/game/events';
import { featureLive } from '@/lib/game/features';
import { contractCountries } from '@/lib/game/licences';
import type { DeliveryFacts } from '@/lib/game/missions';
import { GAME_COUNTRIES } from '@/lib/geo/scope';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { adminAudit, contracts, countries, deliveries, globalEventContributions, globalEvents, notifications, organizations, routes, users } from '@/server/db/schema';
import { requireAdminRole, type Staff } from '@/server/admin';
import { postCoins } from './coins';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { broadcast, notify } from './notify';
import { awardXp } from './progression';
import { t as tr, intlLocale } from '@/i18n/t';

type GlobalEvent = typeof globalEvents.$inferSelect;
const DAY = 86_400_000;

// ── Contributions ─────────────────────────────────────────────────────────

/**
 * Adds a finished delivery to every running event it matches (inside the
 * settlement transaction). Counts by the time the truck arrived, so a late
 * settlement still lands in the right event. The delivery that reaches the
 * goal marks the event complete; later arrivals no longer count.
 */
export async function recordEventProgress(tx: Tx, userId: string, organizationId: string | null, facts: DeliveryFacts, arrivedAt: Date) {
  const candidates = await tx
    .select()
    .from(globalEvents)
    .where(and(lte(globalEvents.startsAt, arrivedAt), gt(globalEvents.endsAt, arrivedAt), isNull(globalEvents.settledAt), or(isNull(globalEvents.completedAt), gt(globalEvents.completedAt, arrivedAt))));
  for (const e of candidates) {
    const inc = eventIncrement({ metric: e.metric as EventMetric, cargoType: e.cargoType, countryCode: e.countryCode }, facts);
    if (!inc) continue;
    const [row] = await tx
      .update(globalEvents)
      .set({ progress: sql`${globalEvents.progress} + ${inc}` })
      .where(and(eq(globalEvents.id, e.id), isNull(globalEvents.settledAt), or(isNull(globalEvents.completedAt), gt(globalEvents.completedAt, arrivedAt))))
      .returning({ progress: globalEvents.progress, target: globalEvents.target, completedAt: globalEvents.completedAt });
    if (!row) continue;
    await tx
      .insert(globalEventContributions)
      .values({ eventId: e.id, userId, organizationId, amount: inc, deliveries: 1, firstAt: arrivedAt })
      .onConflictDoUpdate({
        target: [globalEventContributions.eventId, globalEventContributions.userId],
        set: { amount: sql`${globalEventContributions.amount} + ${inc}`, deliveries: sql`${globalEventContributions.deliveries} + 1`, organizationId },
      });
    if (!row.completedAt && row.progress >= row.target) await tx.update(globalEvents).set({ completedAt: arrivedAt }).where(eq(globalEvents.id, e.id));
  }
}

// ── Settlement ────────────────────────────────────────────────────────────

/** Pays one participant's reward exactly once (idempotency keys per event and player). */
async function payReward(tx: Tx, e: GlobalEvent, userId: string, reward: ReturnType<typeof rewardFor>, rank: number | null, now: Date) {
  const key = `event:${e.id}:${userId}`;
  if (reward.cents) {
    const account = await companyForUser(tx, userId);
    await post(tx, account.id, [{ category: 'event_reward', amountCents: reward.cents, description: tr('Ивент „{0}“{1}', e.name, rank ? tr(' — {0} място', rank) : ''), idempotencyKey: `${key}:money`, refType: 'event', refId: e.id }]);
  }
  if (reward.xp) await awardXp(tx, userId, reward.xp, 'event');
  if (reward.coins) await postCoins(tx, userId, { amount: reward.coins, reason: 'event_reward', description: tr('Ивент „{0}“', e.name), idempotencyKey: `${key}:coins` });
  if (reward.vipDays) {
    const [u] = await tx.select({ vipUntil: users.vipUntil }).from(users).where(eq(users.id, userId)).for('update');
    const until = new Date(Math.max(now.getTime(), u?.vipUntil?.getTime() ?? 0) + reward.vipDays * DAY);
    await tx.update(users).set({ vipUntil: until }).where(eq(users.id, userId));
  }
}

/**
 * Settles one finished event: ranks the participants and, when the goal was
 * reached, pays everyone who contributed at least the minimum plus the bonuses
 * for the top places. Runs once (row lock + settledAt), so a restart never pays twice.
 */
export async function settleEvent(db: Database, eventId: string, now = new Date()): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(globalEvents).where(eq(globalEvents.id, eventId)).for('update');
    if (!e || e.settledAt) return false;
    const cutoff = e.completedAt ?? e.endsAt;
    if (cutoff > now) return false;
    // Trucks that arrived before the cutoff but are not settled yet still count — wait for them.
    const [pending] = await tx.select({ id: deliveries.id }).from(deliveries).where(and(eq(deliveries.status, 'in_progress'), lt(deliveries.etaAt, cutoff), gte(deliveries.etaAt, e.startsAt))).limit(1);
    if (pending) return false;

    const success = e.progress >= e.target;
    const rewards = e.rewards as EventRewards;
    const rows = await tx
      .select({ userId: globalEventContributions.userId, amount: globalEventContributions.amount })
      .from(globalEventContributions)
      .where(and(eq(globalEventContributions.eventId, e.id), gte(globalEventContributions.amount, e.minContribution)))
      .orderBy(desc(globalEventContributions.amount), asc(globalEventContributions.firstAt));
    let rank = 0;
    for (const r of rows) {
      rank++;
      const place = rank <= rewards.top.length ? rank : null;
      const reward = success ? rewardFor(rewards, place) : null;
      if (reward) await payReward(tx, e, r.userId, reward, place, now);
      await tx
        .update(globalEventContributions)
        .set({ rank, reward })
        .where(and(eq(globalEventContributions.eventId, e.id), eq(globalEventContributions.userId, r.userId)));
      await notify(
        tx,
        r.userId,
        success ? 'achievement' : 'info',
        () => success ? tr('Ивентът „{0}“ е успешен!', e.name) : tr('Ивентът „{0}“ приключи', e.name),
        () => success ? tr('Вашето място: {0}. Награда: {1}.', rank, rewardText(reward!)) : tr('Целта не беше достигната ({0}%). Следващия път ще успеем!', Math.round((e.progress / e.target) * 100)),
        '/game/events',
      );
    }
    await tx.update(globalEvents).set({ settledAt: now, outcome: success ? 'success' : 'failed' }).where(eq(globalEvents.id, e.id));
    return true;
  });
}

/** Settles every event whose time is up or whose goal was reached. */
export async function settleDueEvents(db: Database, now = new Date()): Promise<number> {
  const due = await db
    .select({ id: globalEvents.id })
    .from(globalEvents)
    .where(and(isNull(globalEvents.settledAt), or(lte(globalEvents.endsAt, now), isNotNull(globalEvents.completedAt))));
  let settled = 0;
  for (const { id } of due) if (await settleEvent(db, id, now)) settled++;
  if (settled) await broadcast(db, 'leaderboard');
  return settled;
}

// ── Automatic events ──────────────────────────────────────────────────────

/** What the last 7 days of deliveries would have given an event (to size automatic targets). */
export async function recentAmount(db: DbOrTx, filter: { metric: EventMetric; cargoType: string | null; countryCode: string | null }, now: Date) {
  const since = new Date(now.getTime() - 7 * DAY);
  const rows = await db
    .select({
      loadedKm: deliveries.loadedKm,
      late: deliveries.late,
      tons: contracts.weightTons,
      rewardCents: contracts.rewardCents,
      cargoType: contracts.cargoType,
      urgent: contracts.urgent,
      originCountry: sql<string>`(select country_code from cities where id = ${contracts.originCityId})`,
      destCountry: sql<string>`(select country_code from cities where id = ${contracts.destCityId})`,
      routeCountries: routes.countries,
    })
    .from(deliveries)
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .leftJoin(routes, eq(routes.id, deliveries.routeId))
    .where(and(eq(deliveries.status, 'completed'), gte(deliveries.completedAt, since)))
    .limit(50_000);
  let sum = 0;
  for (const r of rows) {
    sum += eventIncrement(filter, {
      loadedKm: r.loadedKm,
      tons: r.tons,
      onTime: !r.late,
      rewardCents: r.rewardCents,
      cargoType: r.cargoType,
      countries: contractCountries(r.originCountry, r.destCountry, r.routeCountries),
      urgent: r.urgent,
      inCompany: false,
    });
  }
  return sum;
}

/**
 * Keeps the automatic events running: when no automatic event is running or
 * announced, schedules the next one (72 h, starting at 18:00 Bulgarian time
 * after a pause) with a target sized to recent activity, and tells everyone.
 */
export async function ensureAutoEvent(db: Database, now = new Date()) {
  const [upcoming] = await db.select({ id: globalEvents.id }).from(globalEvents).where(and(isNotNull(globalEvents.template), gt(globalEvents.endsAt, now))).limit(1);
  if (upcoming) return null;
  const [last] = await db.select({ endsAt: globalEvents.endsAt, template: globalEvents.template }).from(globalEvents).where(isNotNull(globalEvents.template)).orderBy(desc(globalEvents.endsAt)).limit(1);
  const window = nextAutoWindow(last?.endsAt ?? null, now);
  const t = pickTemplate(window.startsAt, last?.template ?? null, featureLive('regional_events', window.startsAt));
  const filter = { metric: t.metric, cargoType: t.cargoType ?? null, countryCode: t.countryCode ?? null };
  const target = autoTarget(t.metric, await recentAmount(db, filter, now), 7 * 24, AUTO_EVENT_HOURS);
  return db.transaction(async (tx) => {
    const [e] = await tx
      .insert(globalEvents)
      .values({ name: t.name, description: t.description, ...filter, target, minContribution: EVENT_METRIC_INFO[t.metric].minContribution, rewards: DEFAULT_REWARDS, ...window, template: t.id })
      .returning();
    await announce(tx, e!, now);
    return e!;
  });
}

export async function announce(tx: Tx, e: GlobalEvent, now: Date) {
  const [country] = e.countryCode ? await tx.select({ nameBg: countries.nameBg }).from(countries).where(eq(countries.code, e.countryCode)) : [];
  const when = e.startsAt <= now ? tr('Започна') : tr('Започва на {0}', e.startsAt.toLocaleString(intlLocale(), { timeZone: 'Europe/Sofia', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }));
  const title = tr('Ивент: {0}', e.name);
  const body = tr('{0}. {1}. Награди за всички участници, а за най-добрите — и VIP.', when, goalText({ metric: e.metric as EventMetric, cargoType: e.cargoType, countryCode: e.countryCode, target: e.target }, country?.nameBg));
  await tx.execute(sql`insert into ${notifications} (user_id, kind, title, body, href) select ${users.id}, 'info', ${title}, ${body}, '/game/events' from ${users} where ${users.bannedAt} is null`);
  await tx.execute(sql`select pg_notify('tv_events', ${JSON.stringify({ type: 'leaderboard' })})`);
}

// ── Administration ────────────────────────────────────────────────────────

const rewardNumbers = {
  eur: z.coerce.number().min(0).max(1_000_000),
  xp: z.coerce.number().int().min(0).max(100_000),
  coins: z.coerce.number().int().min(0).max(10_000),
};

export const eventSchema = z.object({
  name: z.string().trim().min(3, 'Името е поне 3 символа.').max(60, 'Най-много 60 символа.'),
  description: z.string().trim().max(400, 'Най-много 400 символа.').default(''),
  metric: z.enum(EVENT_METRICS),
  cargoType: z.enum(CARGO_TYPES as unknown as [CargoType, ...CargoType[]]).nullable().default(null),
  countryCode: z.enum(GAME_COUNTRIES).nullable().default(null),
  target: z.coerce.number().positive('Целта трябва да е положителна.').max(1e12),
  minContribution: z.coerce.number().min(0).max(1e9),
  /** ISO time; missing or in the past = starts now. */
  startsAt: z.coerce.date().optional(),
  durationHours: z.coerce.number().int().min(1, 'Поне 1 час.').max(30 * 24, 'Най-много 30 дни.'),
  participant: z.object(rewardNumbers),
  top: z.array(z.object({ ...rewardNumbers, vipDays: z.coerce.number().int().min(0).max(90) })).max(MAX_TOP_PLACES),
  announce: z.boolean().default(true),
});
export type EventInput = z.input<typeof eventSchema>;

/** Administrator creates an event with their own goal, period and rewards. */
export async function createEvent(db: Database, actor: Staff, raw: EventInput, now = new Date()) {
  requireAdminRole(actor);
  const input = eventSchema.parse(raw);
  const startsAt = input.startsAt && input.startsAt > now ? input.startsAt : now;
  if (startsAt.getTime() - now.getTime() > 60 * DAY) fail('too_far', tr('Ивентът може да започва най-много след 60 дни.'));
  // Targets in лв. are entered in euros; stored in cents like every amount of money.
  const scale = input.metric === 'earned_cents' ? 100 : 1;
  const cents = (eur: number) => Math.round(eur * 100);
  const rewards: EventRewards = {
    participant: { cents: cents(input.participant.eur), xp: input.participant.xp, coins: input.participant.coins },
    top: input.top.map((t) => ({ cents: cents(t.eur), xp: t.xp, coins: t.coins, vipDays: t.vipDays })),
  };
  return db.transaction(async (tx) => {
    const [e] = await tx
      .insert(globalEvents)
      .values({
        name: input.name,
        description: input.description,
        metric: input.metric,
        cargoType: input.cargoType,
        countryCode: input.countryCode,
        target: input.target * scale,
        minContribution: input.minContribution * scale,
        rewards,
        startsAt,
        endsAt: new Date(startsAt.getTime() + input.durationHours * 3_600_000),
        createdBy: actor.id,
      })
      .returning();
    await tx.insert(adminAudit).values({ actorId: actor.id, action: 'create_global_event', targetUserId: null, details: { eventId: e!.id, name: e!.name, startsAt: e!.startsAt.toISOString(), target: e!.target, metric: e!.metric } });
    if (input.announce) await announce(tx, e!, now);
    else await tx.execute(sql`select pg_notify('tv_events', ${JSON.stringify({ type: 'leaderboard' })})`);
    return e!;
  });
}

/**
 * Administrator starts one of the automatic events' templates now (from the
 * Discord bot): the goal sized to recent activity like the automatic ones,
 * the default rewards. It is not "automatic", so it does not hold them back.
 */
export async function startTemplateEvent(db: Database, actor: Staff, templateId: string, hours: number, now = new Date()) {
  requireAdminRole(actor);
  const t = ALL_EVENT_TEMPLATES.find((x) => x.id === templateId);
  if (!t) fail('no_template', tr('Няма такъв ивент.'));
  if (!(Number.isInteger(hours) && hours >= 1 && hours <= 14 * 24)) fail('bad_hours', tr('Продължителността е от 1 час до 14 дни.'));
  const filter = { metric: t!.metric, cargoType: t!.cargoType ?? null, countryCode: t!.countryCode ?? null };
  const target = autoTarget(t!.metric, await recentAmount(db, filter, now), 7 * 24, hours);
  return db.transaction(async (tx) => {
    const [e] = await tx
      .insert(globalEvents)
      .values({ name: t!.name, description: t!.description, ...filter, target, minContribution: EVENT_METRIC_INFO[t!.metric].minContribution, rewards: DEFAULT_REWARDS, startsAt: now, endsAt: new Date(now.getTime() + hours * 3_600_000), createdBy: actor.id })
      .returning();
    await tx.insert(adminAudit).values({ actorId: actor.id, action: 'create_global_event', targetUserId: null, details: { eventId: e!.id, name: e!.name, startsAt: e!.startsAt.toISOString(), target: e!.target, metric: e!.metric, from: 'discord' } });
    await announce(tx, e!, now);
    return e!;
  });
}

/** Administrator cancels an event that has not been settled yet. Nobody is rewarded. */
export async function cancelEvent(db: Database, actor: Staff, eventId: string, now = new Date()) {
  requireAdminRole(actor);
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(globalEvents).where(eq(globalEvents.id, eventId)).for('update');
    if (!e) fail('event_not_found', tr('Ивентът не е намерен.'), 404);
    if (e!.settledAt) fail('event_settled', tr('Ивентът вече е приключил.'));
    await tx.update(globalEvents).set({ settledAt: now, outcome: 'cancelled' }).where(eq(globalEvents.id, eventId));
    await tx.insert(adminAudit).values({ actorId: actor.id, action: 'cancel_global_event', targetUserId: null, details: { eventId, name: e!.name } });
    const participants = await tx.select({ userId: globalEventContributions.userId }).from(globalEventContributions).where(eq(globalEventContributions.eventId, eventId));
    for (const p of participants) await notify(tx, p.userId, 'warning', () => tr('Ивентът „{0}“ е отменен', e!.name), () => tr('Администрацията отмени ивента. Награди няма да бъдат раздадени.'), '/game/events');
    return true;
  });
}

// ── Views ─────────────────────────────────────────────────────────────────

export interface EventLeader {
  userId: string;
  username: string;
  role: string;
  vipUntil: Date | null;
  company: string | null;
  tag: string | null;
  amount: number;
  deliveries: number;
}

async function leaders(db: DbOrTx, eventId: string, limit: number): Promise<EventLeader[]> {
  return db
    .select({
      userId: globalEventContributions.userId,
      username: users.username,
      role: users.role,
      vipUntil: users.vipUntil,
      company: organizations.name,
      tag: organizations.tag,
      amount: globalEventContributions.amount,
      deliveries: globalEventContributions.deliveries,
    })
    .from(globalEventContributions)
    .innerJoin(users, eq(users.id, globalEventContributions.userId))
    .leftJoin(organizations, eq(organizations.id, globalEventContributions.organizationId))
    .where(eq(globalEventContributions.eventId, eventId))
    .orderBy(desc(globalEventContributions.amount), asc(globalEventContributions.firstAt))
    .limit(limit);
}

/** Everything the events page needs for one event, from the viewer's side. */
async function eventDetail(db: DbOrTx, e: GlobalEvent, userId: string) {
  const [mine] = await db.select().from(globalEventContributions).where(and(eq(globalEventContributions.eventId, e.id), eq(globalEventContributions.userId, userId)));
  const [stats] = await db
    .select({
      participants: sql<number>`count(*) filter (where ${globalEventContributions.amount} >= ${e.minContribution})::int`,
      contributors: sql<number>`count(*)::int`,
      ahead: mine ? sql<number>`count(*) filter (where ${globalEventContributions.amount} > ${mine.amount} or (${globalEventContributions.amount} = ${mine.amount} and ${globalEventContributions.firstAt} < ${mine.firstAt}))::int` : sql<number>`0`,
    })
    .from(globalEventContributions)
    .where(eq(globalEventContributions.eventId, e.id));
  const companies = await db
    .select({ name: organizations.name, tag: organizations.tag, color: organizations.color, amount: sql<number>`sum(${globalEventContributions.amount})::float8`, members: sql<number>`count(*)::int` })
    .from(globalEventContributions)
    .innerJoin(organizations, eq(organizations.id, globalEventContributions.organizationId))
    .where(eq(globalEventContributions.eventId, e.id))
    .groupBy(organizations.id)
    .orderBy(sql`sum(${globalEventContributions.amount}) desc`)
    .limit(5);
  const [country] = e.countryCode ? await db.select({ nameBg: countries.nameBg }).from(countries).where(eq(countries.code, e.countryCode)) : [];
  return {
    event: e,
    countryName: country?.nameBg ?? null,
    leaders: await leaders(db, e.id, 10),
    companies,
    mine: mine ? { amount: mine.amount, deliveries: mine.deliveries, rank: mine.rank ?? stats!.ahead + 1, reward: mine.reward } : null,
    participants: stats?.participants ?? 0,
    contributors: stats?.contributors ?? 0,
  };
}
export type EventDetail = Awaited<ReturnType<typeof eventDetail>>;

/** Running and announced events plus the last finished ones. */
export async function eventsBoard(db: DbOrTx, userId: string, now: Date) {
  const open = await db
    .select()
    .from(globalEvents)
    .where(isNull(globalEvents.settledAt))
    .orderBy(asc(globalEvents.startsAt));
  const past = await db
    .select()
    .from(globalEvents)
    .where(and(isNotNull(globalEvents.settledAt), gt(globalEvents.endsAt, new Date(now.getTime() - 60 * DAY))))
    .orderBy(desc(globalEvents.settledAt))
    .limit(8);
  const details = await Promise.all([...open, ...past].map((e) => eventDetail(db, e, userId)));
  return { open: details.slice(0, open.length), past: details.slice(open.length) };
}

/** Short list for the overview banner: running events with the viewer's contribution. */
export async function runningEvents(db: DbOrTx, userId: string, now: Date) {
  const rows = await db
    .select()
    .from(globalEvents)
    .where(and(isNull(globalEvents.settledAt), lte(globalEvents.startsAt, now)))
    .orderBy(asc(globalEvents.endsAt))
    .limit(3);
  if (!rows.length) return [];
  const mine = await db
    .select({ eventId: globalEventContributions.eventId, amount: globalEventContributions.amount })
    .from(globalEventContributions)
    .where(and(eq(globalEventContributions.userId, userId), inArray(globalEventContributions.eventId, rows.map((r) => r.id))));
  return rows.map((e) => ({ event: e, mine: mine.find((m) => m.eventId === e.id)?.amount ?? 0 }));
}

/** Administrator list of all events. */
export async function adminEvents(db: DbOrTx, limit = 40) {
  return db
    .select({ event: globalEvents, contributors: sql<number>`(select count(*)::int from global_event_contributions c where c.event_id = ${globalEvents.id})`, creator: users.username })
    .from(globalEvents)
    .leftJoin(users, eq(users.id, globalEvents.createdBy))
    .orderBy(desc(globalEvents.startsAt))
    .limit(limit);
}


/**
 * Worker (v1.5): an event an administrator planned for later is announced
 * again when it starts — a notification to everyone, once.
 */
export async function announceStartedEvents(db: Database, now = new Date()) {
  const due = await db
    .select()
    .from(globalEvents)
    .where(and(lte(globalEvents.startsAt, now), gt(globalEvents.endsAt, now), isNull(globalEvents.settledAt), sql`${globalEvents.startsAt} > ${globalEvents.createdAt} + interval '5 minutes'`, sql`${globalEvents.startsAt} > ${new Date(now.getTime() - 6 * 3_600_000)}`));
  let n = 0;
  for (const e of due) {
    await db.transaction(async (tx) => {
      const [fresh] = await tx.execute<{ key: string }>(sql`insert into job_state (key, value) values (${`event-start:${e.id}`}, '{}'::jsonb) on conflict do nothing returning key`).then((r) => r.rows);
      if (!fresh) return;
      await announce(tx, e, now);
      n++;
    });
  }
  return n;
}

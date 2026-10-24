import { and, desc, eq, sql } from 'drizzle-orm';
import { LIVERY_CONTEST, previousMonth, sofiaHourOf, sofiaMonth } from '@/lib/game/together';
import { powerUnitModel } from '@/lib/game/catalog';
import type { Database, DbOrTx } from '@/server/db/client';
import { liveryEntries, liveryVotes, trailers, userBadges, users, vehicles } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { postCoins } from './coins';
import { companyForUser } from './company';
import { fail } from './errors';
import { liveryFor } from './livery';
import { notify } from './notify';
import { t as tr } from '@/i18n/t';

/**
 * The monthly livery contest: each player shows one truck a month (its look
 * at that moment), the others give it 👍 (once each, not their own). On the
 * 1st the truck with the most 👍 (at least a few) wins ТрансКоин and a badge.
 */
export async function enterLiveryContest(db: Database, userId: string, vehicleId: string, now = new Date()) {
  if (!(await featureFor(db, userId, 'livery_contest', now))) fail('not_released', tr('Това идва със следващото обновление.'), 403);
  const account = await companyForUser(db, userId);
  const [v] = await db.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, account.id), sql`${vehicles.soldAt} is null`));
  if (!v) fail('vehicle_not_found', tr('Превозното средство не е намерено.'), 404);
  const [t] = await db.select({ modelId: trailers.modelId }).from(trailers).where(eq(trailers.vehicleId, vehicleId));
  const month = sofiaMonth(now);
  const color = (await liveryFor(db, account.id)) ?? v!.color;
  const [entry] = await db
    .insert(liveryEntries)
    .values({ monthKey: month, userId, vehicleId, modelId: v!.modelId, trailerModelId: t?.modelId ?? null, color, livery: v!.livery, plate: v!.plate, createdAt: now })
    .onConflictDoNothing()
    .returning();
  if (!entry) fail('already_entered', tr('Вече участваш в конкурса този месец.'));
  return entry!;
}

export async function voteLivery(db: Database, userId: string, entryId: string, now = new Date()) {
  if (!(await featureFor(db, userId, 'livery_contest', now))) fail('not_released', tr('Това идва със следващото обновление.'), 403);
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(liveryEntries).where(eq(liveryEntries.id, entryId)).for('update');
    if (!e || e.monthKey !== sofiaMonth(now)) fail('closed', tr('Гласуването за този камион приключи.'), 409);
    if (e!.userId === userId) fail('own', tr('Не можеш да гласуваш за своя камион.'));
    const [vote] = await tx.insert(liveryVotes).values({ entryId, userId, createdAt: now }).onConflictDoNothing().returning();
    if (!vote) fail('already_voted', tr('Вече даде 👍 на този камион.'));
    const [row] = await tx.update(liveryEntries).set({ votes: sql`${liveryEntries.votes} + 1` }).where(eq(liveryEntries.id, entryId)).returning({ votes: liveryEntries.votes });
    return { votes: row!.votes };
  });
}

/** This month's trucks, most 👍 first, with whether the viewer already voted. */
export async function liveryContest(db: DbOrTx, viewerId: string, now = new Date(), month = sofiaMonth(now)) {
  const rows = await db
    .select({ entry: liveryEntries, username: users.username, voted: sql<boolean>`exists (select 1 from livery_votes v where v.entry_id = ${liveryEntries.id} and v.user_id = ${viewerId})` })
    .from(liveryEntries)
    .innerJoin(users, eq(users.id, liveryEntries.userId))
    .where(eq(liveryEntries.monthKey, month))
    .orderBy(desc(liveryEntries.votes), liveryEntries.createdAt)
    .limit(60);
  return rows.map((r) => ({ ...r.entry, username: r.username, voted: r.voted, model: powerUnitModel(r.entry.modelId).name }));
}

/** Worker, the 1st from 10:00: last month's winner (once). Returns the winning entry. */
export async function settleLiveryContest(db: Database, now = new Date()) {
  if (Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', day: 'numeric' }).format(now)) !== 1 || sofiaHourOf(now) < LIVERY_CONTEST.hour) return null;
  const month = previousMonth(sofiaMonth(now));
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`livery:${month}`}))`);
    const [done] = await tx.select({ id: liveryEntries.id }).from(liveryEntries).where(and(eq(liveryEntries.monthKey, month), eq(liveryEntries.won, true)));
    if (done) return null;
    const [best] = await tx.select().from(liveryEntries).where(eq(liveryEntries.monthKey, month)).orderBy(desc(liveryEntries.votes), liveryEntries.createdAt).limit(1);
    if (!best || best.votes < LIVERY_CONTEST.minVotes) return null;
    await tx.update(liveryEntries).set({ won: true }).where(eq(liveryEntries.id, best.id));
    await postCoins(tx, best.userId, { amount: LIVERY_CONTEST.coins, reason: 'livery_contest', description: tr('Ливрея на месеца ({0})', month), idempotencyKey: `livery:${month}` });
    await tx.insert(userBadges).values({ userId: best.userId, badge: LIVERY_CONTEST.badge, awardedAt: now }).onConflictDoNothing();
    await notify(tx, best.userId, 'achievement', () => tr('Ливрея на месеца! 🎨'), () => tr('Камионът {0} събра най-много 👍 ({1}) — +{2} ТрансКоин и значка.', best.plate, best.votes, LIVERY_CONTEST.coins), '/game/livery');
    return best;
  });
}

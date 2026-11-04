/**
 * 1.2.3 „Нов играч наблизо“ (feature `welcome_neighbors`): when someone signs
 * up, a few active players based in the same city are told; each may greet
 * the newcomer once, with a small present from their own account.
 */
import { and, desc, eq, gte, isNull, like, ne, sql } from 'drizzle-orm';
import { featureLive } from '@/lib/game/features';
import { money } from '@/lib/format';
import type { Database, DbOrTx } from '@/server/db/client';
import { cities, companies, jobState, users } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { fail } from './errors';
import { post } from './finance';
import { notify } from './notify';
import { t } from '@/i18n/t';

export const NEIGHBORS = { notify: 5, activeDays: 3, newDays: 7, giftCents: 200_00, maxGreetings: 5 } as const;

/** Called after a sign-up: tells up to five active players with their base in the same city. */
export async function announceNewcomer(db: DbOrTx, userId: string, cityId: number, now = new Date()) {
  const [me] = await db.select({ username: users.username }).from(users).where(eq(users.id, userId));
  const [city] = await db.select({ name: cities.nameBg }).from(cities).where(eq(cities.id, cityId));
  if (!me || !city) return 0;
  const live = featureLive('welcome_neighbors', now);
  const near = await db
    .select({ id: users.id })
    .from(companies)
    .innerJoin(users, eq(users.id, companies.ownerId))
    .where(and(eq(companies.hqCityId, cityId), ne(users.id, userId), isNull(users.bannedAt), gte(users.lastSeenAt, new Date(now.getTime() - NEIGHBORS.activeDays * 86_400_000)), ...(live ? [] : [sql`${users.role} <> 'player'`])))
    .orderBy(desc(users.lastSeenAt))
    .limit(NEIGHBORS.notify);
  for (const n of near) await notify(db, n.id, 'info', () => t('Нов играч в {0}: {1}', city.name, me.username), () => t('Поздрави го и му подари {0} за начало.', money(NEIGHBORS.giftCents)), `/game/players/${encodeURIComponent(me.username)}?greet=${userId}`);
  return near.length;
}

/** May the viewer greet this player (new, not greeted yet by them, not over the limit)? */
export async function canGreet(db: DbOrTx, viewerId: string, target: { id: string; createdAt: Date }, now = new Date()) {
  if (viewerId === target.id || now.getTime() - target.createdAt.getTime() > NEIGHBORS.newDays * 86_400_000) return false;
  const [done] = await db.select({ key: jobState.key }).from(jobState).where(eq(jobState.key, `greet:${viewerId}:${target.id}`));
  return !done;
}

/** Greets a new player: a notification and a present of 200 лв. from the greeter's own account (once per pair). */
export async function greetNewcomer(db: Database, userId: string, targetId: string, now = new Date()) {
  if (!(await featureFor(db, userId, 'welcome_neighbors', now))) fail('not_released', t('Това идва със следващото обновление.'), 403);
  return db.transaction(async (tx) => {
    const [target] = await tx.select({ id: users.id, username: users.username, createdAt: users.createdAt }).from(users).where(eq(users.id, targetId));
    if (!target) fail('not_found', t('Играчът не е намерен.'), 404);
    if (!(await canGreet(tx, userId, target!, now))) fail('cannot_greet', t('Можеш да поздравиш само нов играч (до 7 дни), веднъж.'), 409);
    const [{ n = 0 } = {}] = await tx.select({ n: sql<number>`count(*)::int` }).from(jobState).where(like(jobState.key, `greet:%:${targetId}`));
    if (n >= NEIGHBORS.maxGreetings) fail('enough_greetings', t('Този играч вече е поздравен от достатъчно хора.'), 409);
    await tx.insert(jobState).values({ key: `greet:${userId}:${targetId}`, value: { at: now.toISOString() } });
    const [from] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
    const [to] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, targetId));
    const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, userId));
    if (!from || !to) fail('no_account', t('Сметката не е намерена.'), 404);
    // Personal accounts: the sender first, then the receiver (fixed lock order by role).
    await post(tx, from!.id, [{ category: 'transfer_out', amountCents: -NEIGHBORS.giftCents, description: t('Подарък за нов играч: {0}', target!.username), idempotencyKey: `greet:${userId}:${targetId}:out` }], { requireFunds: true });
    await post(tx, to!.id, [{ category: 'transfer_in', amountCents: NEIGHBORS.giftCents, description: t('Подарък от {0}: добре дошъл!', me!.username), idempotencyKey: `greet:${userId}:${targetId}:in` }]);
    await notify(tx, targetId, 'success', () => t('{0} те поздрави!', me!.username), () => t('„Добре дошъл на пътя!“ — и {0} за начало.', money(NEIGHBORS.giftCents)), `/game/players/${encodeURIComponent(me!.username)}`);
    return { cents: NEIGHBORS.giftCents };
  });
}

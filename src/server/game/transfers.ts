import { and, desc, eq, gte, or, sql } from 'drizzle-orm';
import { aliasedTable } from 'drizzle-orm';
import { z } from 'zod';
import { money } from '@/lib/format';
import { TRANSFER_RULES, transferFeeCents } from '@/lib/game/transfers';
import type { Database, DbOrTx } from '@/server/db/client';
import { moneyTransfers, users } from '@/server/db/schema';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { assertNotBlocked } from './moderation';
import { notify } from './notify';
import { t } from '@/i18n/t';

export const transferSchema = z.object({
  toUserId: z.string().uuid('Невалиден играч.'),
  amount: z.coerce.number().int('Сумата е в цели лева.').min(TRANSFER_RULES.minCents / 100, `Най-малко ${money(TRANSFER_RULES.minCents)}`).max(TRANSFER_RULES.dailyLimitCents / 100, `Най-много ${money(TRANSFER_RULES.dailyLimitCents)} на ден.`),
  note: z.string().trim().max(TRANSFER_RULES.noteMax, `Бележката е до ${TRANSFER_RULES.noteMax} знака.`).optional().default(''),
});

/** How much the player has sent in the last 24 hours (without fees). */
export async function sentLast24h(db: DbOrTx, userId: string, now: Date): Promise<number> {
  const [r] = await db
    .select({ sum: sql<number>`coalesce(sum(${moneyTransfers.amountCents}), 0)::bigint` })
    .from(moneyTransfers)
    .where(and(eq(moneyTransfers.fromUserId, userId), gte(moneyTransfers.createdAt, new Date(now.getTime() - 86_400_000))));
  return Number(r?.sum ?? 0);
}

/** Why this player cannot send money yet (null when they can). */
export function senderBlock(u: { level: number; createdAt: Date }, now: Date): string | null {
  if (u.level < TRANSFER_RULES.minLevel) return t('Пари може да се пращат от ниво {0}.', TRANSFER_RULES.minLevel);
  const days = (now.getTime() - u.createdAt.getTime()) / 86_400_000;
  if (days < TRANSFER_RULES.minAccountDays) return t('Пари може да се пращат, след като профилът е на {0} дни.', TRANSFER_RULES.minAccountDays);
  return null;
}

/**
 * Sends game money to another player. The sender pays the amount plus the fee
 * (which leaves the game); the receiver gets the amount. Both get a ledger
 * entry and the receiver a notification. `ipHash` is the sender's network now.
 */
export async function sendMoney(db: Database, userId: string, raw: z.input<typeof transferSchema>, ipHash: string | null, now = new Date()) {
  const input = transferSchema.parse(raw);
  if (input.toUserId === userId) fail('self', t('Не можеш да пращаш пари на себе си.'));
  const amountCents = input.amount * 100;
  return db.transaction(async (tx) => {
    // The sender's row is locked so two transfers at once cannot pass the daily limit together.
    const [me] = await tx.select({ id: users.id, username: users.username, level: users.level, createdAt: users.createdAt, bannedAt: users.bannedAt, ipHash: users.signupIpHash }).from(users).where(eq(users.id, userId)).for('update');
    const [to] = await tx.select({ id: users.id, username: users.username, bannedAt: users.bannedAt, ipHash: users.signupIpHash }).from(users).where(eq(users.id, input.toUserId));
    if (!me || me.bannedAt) fail('forbidden', t('Профилът не може да праща пари.'), 403);
    if (!to || to.bannedAt) fail('player_not_found', t('Играчът не е намерен.'), 404);
    const blocked = senderBlock(me!, now);
    if (blocked) fail('transfer_locked', blocked, 403);
    await assertNotBlocked(tx, userId, to!.id);
    // Same network (at sign-up or now): most likely a second account of the same person.
    if (to!.ipHash && (to!.ipHash === me!.ipHash || to!.ipHash === ipHash)) fail('same_network', t('Не може да пращаш пари на профил от същата мрежа.'), 403);
    const sent = await sentLast24h(tx, userId, now);
    if (sent + amountCents > TRANSFER_RULES.dailyLimitCents) fail('daily_limit', t('Може да изпратиш още {0} за 24 часа.', money(Math.max(0, TRANSFER_RULES.dailyLimitCents - sent))));

    const feeCents = transferFeeCents(amountCents);
    const [row] = await tx.insert(moneyTransfers).values({ fromUserId: userId, toUserId: to!.id, amountCents, feeCents, note: input.note || null, createdAt: now }).returning({ id: moneyTransfers.id });
    const from = await companyForUser(tx, userId);
    const dest = await companyForUser(tx, to!.id);
    const note = input.note ? ` — „${input.note}“` : '';
    await post(
      tx,
      from.id,
      [
        { category: 'transfer_out', amountCents: -amountCents, description: t('Изпратени на {0}{1}', to!.username, note), idempotencyKey: `transfer:${row!.id}:out`, refType: 'transfer', refId: row!.id },
        { category: 'transfer_out', amountCents: -feeCents, description: t('Такса за превод ({0} %)', Math.round(TRANSFER_RULES.feeShare * 100)), idempotencyKey: `transfer:${row!.id}:fee`, refType: 'transfer', refId: row!.id },
      ],
      { requireFunds: true },
    );
    await post(tx, dest.id, [{ category: 'transfer_in', amountCents, description: t('Получени от {0}{1}', me!.username, note), idempotencyKey: `transfer:${row!.id}:in`, refType: 'transfer', refId: row!.id }]);
    await notify(tx, to!.id, 'success', () => t('{0} ти изпрати {1}', me!.username, money(amountCents)), () => input.note ? `„${input.note}“` : t('Парите са в баланса ти.'), '/game/finance#transfers');
    return { id: row!.id, amountCents, feeCents };
  });
}

/** The player's transfers, both ways, newest first. */
export async function transfersOf(db: DbOrTx, userId: string, limit = 30) {
  const sender = aliasedTable(users, 'sender');
  const receiver = aliasedTable(users, 'receiver');
  const rows = await db
    .select({ id: moneyTransfers.id, fromUserId: moneyTransfers.fromUserId, amountCents: moneyTransfers.amountCents, feeCents: moneyTransfers.feeCents, note: moneyTransfers.note, createdAt: moneyTransfers.createdAt, from: sender.username, to: receiver.username })
    .from(moneyTransfers)
    .innerJoin(sender, eq(sender.id, moneyTransfers.fromUserId))
    .innerJoin(receiver, eq(receiver.id, moneyTransfers.toUserId))
    .where(or(eq(moneyTransfers.fromUserId, userId), eq(moneyTransfers.toUserId, userId)))
    .orderBy(desc(moneyTransfers.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, outgoing: r.fromUserId === userId }));
}

/** All transfers (administrators). */
export async function recentTransfers(db: DbOrTx, limit = 100) {
  const sender = aliasedTable(users, 'sender');
  const receiver = aliasedTable(users, 'receiver');
  return db
    .select({ id: moneyTransfers.id, amountCents: moneyTransfers.amountCents, feeCents: moneyTransfers.feeCents, note: moneyTransfers.note, createdAt: moneyTransfers.createdAt, from: sender.username, fromId: sender.id, to: receiver.username, toId: receiver.id })
    .from(moneyTransfers)
    .innerJoin(sender, eq(sender.id, moneyTransfers.fromUserId))
    .innerJoin(receiver, eq(receiver.id, moneyTransfers.toUserId))
    .orderBy(desc(moneyTransfers.createdAt))
    .limit(limit);
}

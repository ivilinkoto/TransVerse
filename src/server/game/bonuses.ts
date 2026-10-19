import { and, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { money } from '@/lib/format';
import { BONUS_RULES } from '@/lib/game/company';
import type { Database, DbOrTx } from '@/server/db/client';
import { companies, companyMembers, organizations, treasuryEntries, users } from '@/server/db/schema';
import { companyForUser } from './company';
import { fail } from './errors';
import { post, postTreasury } from './finance';
import { can, membershipOf } from './membership';
import { logActivity, notify } from './notify';

export const bonusSchema = z.object({
  userId: z.string().uuid('Невалиден член.'),
  amount: z.coerce.number().int('Сумата е в цели лева.').min(BONUS_RULES.minCents / 100, `Най-малко ${money(BONUS_RULES.minCents)}`).max(BONUS_RULES.maxCents / 100, `Най-много ${money(BONUS_RULES.maxCents)} на премия.`),
  note: z.string().trim().max(BONUS_RULES.noteMax, `Бележката е до ${BONUS_RULES.noteMax} знака.`).optional().default(''),
});

/** Bonuses the company paid in the last 24 hours (the sum). */
export async function bonusesLast24h(db: DbOrTx, organizationId: string, now: Date): Promise<number> {
  const [r] = await db
    .select({ sum: sql<number>`coalesce(-sum(${treasuryEntries.amountCents}), 0)::bigint` })
    .from(treasuryEntries)
    .where(and(eq(treasuryEntries.organizationId, organizationId), eq(treasuryEntries.category, 'member_bonus'), gte(treasuryEntries.createdAt, new Date(now.getTime() - 86_400_000))));
  return Number(r?.sum ?? 0);
}

/** What the company may still pay out in bonuses today (a share of the treasury, capped). */
export function bonusRoomCents(treasuryCents: number, paidToday: number): number {
  const cap = Math.min(BONUS_RULES.companyDailyMaxCents, Math.floor(Math.max(0, treasuryCents + paidToday) * BONUS_RULES.companyDailyShare));
  return Math.max(0, Math.min(cap - paidToday, treasuryCents));
}

/**
 * A member with the "bonuses" right pays another member a bonus from the
 * treasury. Not to oneself, not to a member of a few days or from the same
 * network, one per member a day, within the company's daily room.
 */
export async function payBonus(db: Database, actorId: string, raw: z.input<typeof bonusSchema>, ipHash: string | null, now = new Date()) {
  const input = bonusSchema.parse(raw);
  if (input.userId === actorId) fail('self', 'Премия не се дава на себе си.');
  const amountCents = input.amount * 100;
  return db.transaction(async (tx) => {
    const actor = await membershipOf(tx, actorId);
    if (!actor) fail('not_member', 'Не членувате в компания.', 403);
    if (!can(actor!.rank, 'pay_bonuses')) fail('forbidden', 'Длъжността ви няма това право.', 403);
    // Same lock order as delivery settlement: the member's account first, then the company
    // (whose row lock keeps two bonuses at once from passing the daily room together).
    await tx.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, input.userId)).for('update');
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, actor!.company.id)).for('update');
    const [member] = await tx
      .select({ joinedAt: companyMembers.joinedAt, username: users.username, bannedAt: users.bannedAt, ipHash: users.signupIpHash })
      .from(companyMembers)
      .innerJoin(users, eq(users.id, companyMembers.userId))
      .where(and(eq(companyMembers.userId, input.userId), eq(companyMembers.companyId, org!.id)));
    if (!member || member.bannedAt) fail('not_member', 'Играчът не е член на компанията.', 404);
    if (now.getTime() - member!.joinedAt.getTime() < BONUS_RULES.minMemberDays * 86_400_000) fail('too_new', `Премия се дава на членове от поне ${BONUS_RULES.minMemberDays} дни.`);
    const [me] = await tx.select({ username: users.username, ipHash: users.signupIpHash }).from(users).where(eq(users.id, actorId));
    if (member!.ipHash && (member!.ipHash === me?.ipHash || member!.ipHash === ipHash)) fail('same_network', 'Не може премия на профил от същата мрежа.', 403);
    const [recent] = await tx
      .select({ id: treasuryEntries.id })
      .from(treasuryEntries)
      .where(and(eq(treasuryEntries.organizationId, org!.id), eq(treasuryEntries.category, 'member_bonus'), eq(treasuryEntries.refId, input.userId), gte(treasuryEntries.createdAt, new Date(now.getTime() - BONUS_RULES.perMemberHours * 3_600_000))))
      .limit(1);
    if (recent) fail('bonus_today', `${member!.username} вече получи премия през последните ${BONUS_RULES.perMemberHours} часа.`);
    const room = bonusRoomCents(org!.treasuryCents, await bonusesLast24h(tx, org!.id, now));
    if (amountCents > room) fail('bonus_limit', room > 0 ? `Днес компанията може да даде още ${money(room)} премии.` : 'Днешният лимит за премии е изчерпан.');

    const op = `${org!.id}:${input.userId}:${now.getTime()}`;
    const note = input.note ? ` — „${input.note}“` : '';
    await postTreasury(tx, org!.id, [{ category: 'member_bonus', amountCents: -amountCents, description: `Премия за ${member!.username}${note}`, idempotencyKey: `bonus:${op}:out`, actorUserId: actorId, refType: 'user', refId: input.userId }], { requireFunds: true });
    const account = await companyForUser(tx, input.userId);
    await post(tx, account.id, [{ category: 'member_bonus', amountCents, description: `Премия от „${org!.name}“${note}`, idempotencyKey: `bonus:${op}:in`, refType: 'company', refId: org!.id }]);
    await notify(tx, input.userId, 'success', `Премия ${money(amountCents)} от „${org!.name}“`, `${me!.username} ти даде премия${input.note ? `: „${input.note}“` : ' за добрата работа'}.`, '/game/finance');
    await logActivity(tx, actorId, 'member_bonus', { companyId: org!.id, userId: input.userId, amountCents });
    return { amountCents };
  });
}

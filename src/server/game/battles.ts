import { and, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { money } from '@/lib/format';
import { battleOutcome, BATTLE_RULES, pairCompanies } from '@/lib/game/battles';
import { periodWindow } from '@/lib/game/missions';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { companies, companyBattles, companyMembers, deliveries, organizations } from '@/server/db/schema';
import { addFeed } from './feed';
import { postTreasury } from './finance';
import { addCompanyXp, notifyMembers } from './membership';
import { addChronicle } from './chronicle';

export type CompanyBattle = typeof companyBattles.$inferSelect;

/**
 * Worker: pairs this week's battles once (companies with a member delivery in
 * the last two weeks, by level), and tells both companies who they face.
 */
export async function ensureWeeklyBattles(db: Database, now = new Date()) {
  const week = periodWindow('weekly', now);
  return db.transaction(async (tx) => {
    // One pairing per week, even with two workers.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`battles:${week.key}`}))`);
    const [existing] = await tx.select({ id: companyBattles.id }).from(companyBattles).where(eq(companyBattles.weekKey, week.key)).limit(1);
    if (existing) return 0;
    const since = new Date(now.getTime() - BATTLE_RULES.activeDays * 86_400_000);
    const active = await tx
      .selectDistinct({ id: organizations.id, name: organizations.name, level: organizations.companyLevel, xp: organizations.companyXp })
      .from(organizations)
      .innerJoin(companyMembers, eq(companyMembers.companyId, organizations.id))
      .innerJoin(companies, eq(companies.ownerId, companyMembers.userId))
      .innerJoin(deliveries, and(eq(deliveries.companyId, companies.id), eq(deliveries.status, 'completed'), gte(deliveries.completedAt, since)));
    const pairs = pairCompanies(active, week.key);
    for (const [a, b] of pairs) {
      await tx.insert(companyBattles).values({ weekKey: week.key, aId: a.id, bId: b.id, endsAt: week.endsAt, createdAt: now });
      await notifyMembers(tx, a.id, null, `Битка на компаниите: срещу „${b.name}“`, `Тази седмица всеки тон, който превозите, се брои. Победителят взема ${money(BATTLE_RULES.rewardCents)} за касата и трофей.`, '/game/company/missions');
      await notifyMembers(tx, b.id, null, `Битка на компаниите: срещу „${a.name}“`, `Тази седмица всеки тон, който превозите, се брои. Победителят взема ${money(BATTLE_RULES.rewardCents)} за касата и трофей.`, '/game/company/missions');
    }
    return pairs.length;
  });
}

/** A member's load arrived: its tonnes count for the company's battle this week. */
export async function recordBattleDelivery(tx: Tx, organizationId: string, tons: number, now: Date) {
  const week = periodWindow('weekly', now).key;
  await tx.update(companyBattles).set({ aTons: sql`${companyBattles.aTons} + ${tons}` }).where(and(eq(companyBattles.weekKey, week), eq(companyBattles.aId, organizationId), eq(companyBattles.status, 'active')));
  await tx.update(companyBattles).set({ bTons: sql`${companyBattles.bTons} + ${tons}` }).where(and(eq(companyBattles.weekKey, week), eq(companyBattles.bId, organizationId), eq(companyBattles.status, 'active')));
}

/** Worker: settles the battles whose week is over — the reward to the winner (a draw splits it). */
export async function settleBattles(db: Database, now = new Date()) {
  const due = await db.select({ id: companyBattles.id }).from(companyBattles).where(and(eq(companyBattles.status, 'active'), lte(companyBattles.endsAt, now))).limit(100);
  for (const { id } of due) {
    await db.transaction(async (tx) => {
      const [b] = await tx.select().from(companyBattles).where(and(eq(companyBattles.id, id), eq(companyBattles.status, 'active'))).for('update');
      if (!b) return;
      const outcome = battleOutcome(b.aTons, b.bTons);
      const winnerId = outcome === 'win' ? b.aId : outcome === 'loss' ? b.bId : null;
      await tx.update(companyBattles).set({ status: 'done', winnerId, settledAt: now }).where(eq(companyBattles.id, b.id));
      const names = new Map((await tx.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, [b.aId, b.bId]))).map((o) => [o.id, o.name]));
      const score = (side: 'a' | 'b') => (side === 'a' ? `${Math.round(b.aTons)} : ${Math.round(b.bTons)} т` : `${Math.round(b.bTons)} : ${Math.round(b.aTons)} т`);
      const pay = async (orgId: string, share: number) => {
        await postTreasury(tx, orgId, [{ category: 'company_battle', amountCents: Math.round(BATTLE_RULES.rewardCents * share), description: `Битка на компаниите срещу „${names.get(orgId === b.aId ? b.bId : b.aId)}“`, idempotencyKey: `battle:${b.id}:${orgId}`, refType: 'company_battle', refId: b.id }]);
        await addCompanyXp(tx, orgId, Math.round(BATTLE_RULES.rewardXp * share));
      };
      if (outcome === 'draw') {
        await pay(b.aId, 0.5);
        await pay(b.bId, 0.5);
      } else if (winnerId) {
        await pay(winnerId, 1);
        await addFeed(tx, { organizationId: winnerId, kind: 'battle', text: `компанията спечели битката срещу „${names.get(winnerId === b.aId ? b.bId : b.aId)}“ (${Math.round(Math.max(b.aTons, b.bTons))} : ${Math.round(Math.min(b.aTons, b.bTons))} т)` }, now);
        await addChronicle(tx, winnerId, 'battle', `Победа в битката срещу „${names.get(winnerId === b.aId ? b.bId : b.aId)}“ (${Math.round(Math.max(b.aTons, b.bTons))} : ${Math.round(Math.min(b.aTons, b.bTons))} т)`, now);
      }
      for (const [orgId, side] of [[b.aId, 'a'], [b.bId, 'b']] as const) {
        const other = names.get(side === 'a' ? b.bId : b.aId);
        const text =
          outcome === 'none' ? 'Никой не превози товар — битката е без победител.'
          : outcome === 'draw' ? `Равенство (${score(side)}) — наградата се дели.`
          : winnerId === orgId ? `Победа ${score(side)}! ${money(BATTLE_RULES.rewardCents)} влязоха в касата.`
          : `Загуба ${score(side)}. Следващата седмица — нов съперник.`;
        await notifyMembers(tx, orgId, null, `Битката срещу „${other}“ приключи`, text, '/game/company/missions');
      }
    });
  }
  return due.length;
}

/** The company's battle this week (with the rival's name), for the company page. */
export async function currentBattle(db: DbOrTx, organizationId: string, now = new Date()) {
  const week = periodWindow('weekly', now).key;
  const [b] = await db.select().from(companyBattles).where(and(eq(companyBattles.weekKey, week), or(eq(companyBattles.aId, organizationId), eq(companyBattles.bId, organizationId))));
  if (!b) return null;
  const mine = b.aId === organizationId;
  const rivalId = mine ? b.bId : b.aId;
  const [rival] = await db.select({ id: organizations.id, name: organizations.name, tag: organizations.tag, level: organizations.companyLevel }).from(organizations).where(eq(organizations.id, rivalId));
  return { id: b.id, endsAt: b.endsAt, status: b.status, ourTons: mine ? b.aTons : b.bTons, theirTons: mine ? b.bTons : b.aTons, rival: rival ?? null };
}

/** Battles a company has won (the trophies on its profile) and its last results. */
export async function battleRecord(db: DbOrTx, organizationId: string, limit = 5) {
  const mine = or(eq(companyBattles.aId, organizationId), eq(companyBattles.bId, organizationId));
  const [{ wins = 0 } = {}] = await db.select({ wins: sql<number>`count(*)::int` }).from(companyBattles).where(and(eq(companyBattles.status, 'done'), eq(companyBattles.winnerId, organizationId)));
  const rows = await db.select().from(companyBattles).where(and(eq(companyBattles.status, 'done'), mine)).orderBy(desc(companyBattles.endsAt)).limit(limit);
  const rivalIds = rows.map((b) => (b.aId === organizationId ? b.bId : b.aId));
  const names = rivalIds.length ? new Map((await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, rivalIds))).map((o) => [o.id, o.name])) : new Map<string, string>();
  return {
    wins,
    recent: rows.map((b) => {
      const a = b.aId === organizationId;
      return { id: b.id, at: b.endsAt, rival: names.get(a ? b.bId : b.aId) ?? 'компания', ourTons: a ? b.aTons : b.bTons, theirTons: a ? b.bTons : b.aTons, result: b.winnerId === organizationId ? ('win' as const) : b.winnerId ? ('loss' as const) : ('draw' as const) };
    }),
  };
}

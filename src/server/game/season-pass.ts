import { and, eq, sql } from 'drizzle-orm';
import { PASS_LEVELS, PASS_PRICE_COINS, PASS_REWARDS, passLevel, type PassReward } from '@/lib/game/season-pass';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { companies, seasonPasses, users } from '@/server/db/schema';
import { postCoins } from './coins';
import { fail } from './errors';
import { post } from './finance';
import { logActivity } from './notify';
import { activeSeason } from './seasons';
import { t } from '@/i18n/t';

/** Season points of a delivery also fill the pass. */
export async function addPassPoints(tx: Tx, userId: string, points: number, now = new Date()) {
  const season = await activeSeason(tx, now);
  await tx
    .insert(seasonPasses)
    .values({ seasonId: season.id, userId, points })
    .onConflictDoUpdate({ target: [seasonPasses.seasonId, seasonPasses.userId], set: { points: sql`${seasonPasses.points} + ${points}`, updatedAt: now } });
}

async function passRow(tx: DbOrTx, seasonId: number, userId: string, lock = false) {
  await tx.insert(seasonPasses).values({ seasonId, userId }).onConflictDoNothing();
  const q = tx.select().from(seasonPasses).where(and(eq(seasonPasses.seasonId, seasonId), eq(seasonPasses.userId, userId)));
  return (lock ? await q.for('update') : await q)[0]!;
}

export async function passView(db: DbOrTx, userId: string, now = new Date()) {
  const season = await activeSeason(db, now);
  const [row] = await db.select().from(seasonPasses).where(and(eq(seasonPasses.seasonId, season.id), eq(seasonPasses.userId, userId)));
  const points = row?.points ?? 0;
  const level = passLevel(points);
  const claimedFree = new Set(row?.claimedFree ?? []);
  const claimedPremium = new Set(row?.claimedPremium ?? []);
  const premium = row?.premium ?? false;
  const claimable = PASS_REWARDS.filter((r) => r.level <= level && ((r.free && !claimedFree.has(r.level)) || (premium && !claimedPremium.has(r.level)))).length;
  return { season, points, level, premium, claimedFree: [...claimedFree], claimedPremium: [...claimedPremium], claimable };
}

/** Unlocks the premium track for this season with ТрансКоин. Rewards of reached levels can be claimed at once. */
export async function buyPremiumPass(db: Database, userId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const season = await activeSeason(tx, now);
    const row = await passRow(tx, season.id, userId, true);
    if (row.premium) fail('already_premium', t('Вече имаш премиум пропуска за този сезон.'), 409);
    await postCoins(tx, userId, { amount: -PASS_PRICE_COINS, reason: 'season_pass', description: t('Премиум пропуск: {0}', season.name), idempotencyKey: `pass:${season.id}:${userId}` }, { requireFunds: true });
    await tx.update(seasonPasses).set({ premium: true, updatedAt: now }).where(and(eq(seasonPasses.seasonId, season.id), eq(seasonPasses.userId, userId)));
    await logActivity(tx, userId, 'season_pass_bought', { seasonId: season.id });
  });
}

async function grant(tx: Tx, userId: string, r: PassReward, key: string, label: string, now: Date) {
  if (r.cents) {
    const [acct] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
    if (acct) await post(tx, acct.id, [{ category: 'season_pass', amountCents: r.cents, description: label, idempotencyKey: `${key}:cents` }]);
  }
  if (r.coins) await postCoins(tx, userId, { amount: r.coins, reason: 'season_pass', description: label, idempotencyKey: `${key}:coins` });
  if (r.vipDays || r.xpBoostHours) {
    const [u] = await tx.select({ vipUntil: users.vipUntil, xpBoostUntil: users.xpBoostUntil }).from(users).where(eq(users.id, userId)).for('update');
    const extend = (from: Date | null | undefined, ms: number) => new Date(Math.max(now.getTime(), from?.getTime() ?? 0) + ms);
    await tx
      .update(users)
      .set({
        ...(r.vipDays ? { vipUntil: extend(u?.vipUntil, r.vipDays * 86_400_000) } : {}),
        ...(r.xpBoostHours ? { xpBoostUntil: extend(u?.xpBoostUntil, r.xpBoostHours * 3_600_000) } : {}),
      })
      .where(eq(users.id, userId));
  }
}

/** Claims every reached, unclaimed reward (free, and premium when unlocked). Returns how many were claimed. */
export async function claimPassRewards(db: Database, userId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const season = await activeSeason(tx, now);
    const row = await passRow(tx, season.id, userId, true);
    const level = passLevel(row.points);
    const free = new Set(row.claimedFree);
    const prem = new Set(row.claimedPremium);
    let claimed = 0;
    for (const r of PASS_REWARDS.slice(0, Math.min(level, PASS_LEVELS))) {
      if (r.free && !free.has(r.level)) {
        await grant(tx, userId, r.free, `pass:${season.id}:${userId}:free:${r.level}`, t('Пропуск ниво {0}', r.level), now);
        free.add(r.level);
        claimed++;
      }
      if (row.premium && !prem.has(r.level)) {
        await grant(tx, userId, r.premium, `pass:${season.id}:${userId}:premium:${r.level}`, t('Премиум пропуск ниво {0}', r.level), now);
        prem.add(r.level);
        claimed++;
      }
    }
    if (!claimed) fail('nothing_to_claim', t('Няма награди за взимане — карай още, за да вдигнеш нивото на пропуска.'));
    await tx.update(seasonPasses).set({ claimedFree: [...free].sort((a, b) => a - b), claimedPremium: [...prem].sort((a, b) => a - b), updatedAt: now }).where(and(eq(seasonPasses.seasonId, season.id), eq(seasonPasses.userId, userId)));
    return claimed;
  });
}

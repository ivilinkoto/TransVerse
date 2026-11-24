/**
 * 1.3.2.4 „Турнир на седмицата“ (rules in src/lib/game/tournament.ts). An entry
 * is `job_state` `tourney:<tier>:<week>:<user>` ({ joinedAt }); the settlement
 * of a week is guarded by `tourney-settled:<tier>:<week>`.
 */
import { and, eq, gte, inArray, like, lt, sql } from 'drizzle-orm';
import { weekEndsAt, weekKey } from '@/lib/game/leagues';
import { TOURNAMENT, TOURNAMENT_TIERS, TOURNAMENTS, tournamentPool, tournamentPrizes, type TournamentTier } from '@/lib/game/tournament';
import type { Database, DbOrTx } from '@/server/db/client';
import { companies, contracts, deliveries, jobState, users } from '@/server/db/schema';
import { postCoins } from './coins';
import { fail } from './errors';
import { notify } from './notify';
import { t } from '@/i18n/t';

const prefix = (tier: TournamentTier, week: string) => `tourney:${tier}:${week}:`;
const entryKey = (tier: TournamentTier, week: string, userId: string) => `${prefix(tier, week)}${userId}`;
interface Entry { joinedAt: string }

async function entries(db: DbOrTx, tier: TournamentTier, week: string) {
  const rows = await db.select({ key: jobState.key, value: jobState.value }).from(jobState).where(like(jobState.key, `${prefix(tier, week)}%`));
  return rows.map((r) => ({ userId: r.key.slice(prefix(tier, week).length), joinedAt: new Date((r.value as Entry).joinedAt) }));
}

/** The players of a week by score: the tons their trucks delivered from their entry until `until` (at most the week's end). */
export async function standings(db: DbOrTx, tier: TournamentTier, week: string, until: Date) {
  const list = await entries(db, tier, week);
  if (!list.length) return [];
  const end = new Date(Math.min(until.getTime(), weekEndsAt(week).getTime()));
  const accounts = await db.select({ owner: companies.ownerId, id: companies.id }).from(companies).where(inArray(companies.ownerId, list.map((e) => e.userId)));
  const names = new Map((await db.select({ id: users.id, name: users.username }).from(users).where(inArray(users.id, list.map((e) => e.userId)))).map((u) => [u.id, u.name]));
  const scored = await Promise.all(list.map(async (e) => {
    const acc = accounts.find((a) => a.owner === e.userId);
    const [row] = acc ? await db.select({ tons: sql<number>`coalesce(sum(${contracts.weightTons}), 0)::float` }).from(deliveries).innerJoin(contracts, eq(contracts.id, deliveries.contractId))
      .where(and(eq(deliveries.companyId, acc.id), eq(deliveries.status, 'completed'), gte(deliveries.completedAt, e.joinedAt), lt(deliveries.completedAt, end))) : [];
    return { userId: e.userId, name: names.get(e.userId) ?? '', joinedAt: e.joinedAt, tons: Math.round((row?.tons ?? 0) * 10) / 10 };
  }));
  // More tons first; on a tie, who entered first.
  return scored.sort((a, b) => b.tons - a.tons || a.joinedAt.getTime() - b.joinedAt.getTime());
}

/** Enters this week's tournament of a tier for its fee (once a week; „Голямата купа“ from its level). */
export async function joinTournament(db: Database, userId: string, tier: TournamentTier, now: Date) {
  const week = weekKey(now);
  const def = TOURNAMENTS[tier];
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ id: users.id, level: users.level }).from(users).where(eq(users.id, userId)).for('update');
    if (!u) fail('not_found', t('Играчът не е намерен.'), 404);
    if (u!.level < def.minLevel) fail('level', t('{0} е от ниво {1}.', t(def.label), def.minLevel));
    const [had] = await tx.select({ key: jobState.key }).from(jobState).where(eq(jobState.key, entryKey(tier, week, userId)));
    if (had) fail('already_in', t('Вече участваш в този турнир тази седмица.'));
    await postCoins(tx, userId, { amount: -def.feeCoins, reason: 'tournament_fee', description: t('Вход: {0}', t(def.label)), idempotencyKey: `tourney-fee:${tier}:${week}:${userId}` }, { requireFunds: true });
    await tx.insert(jobState).values({ key: entryKey(tier, week, userId), value: { joinedAt: now.toISOString() } satisfies Entry, updatedAt: now });
    return week;
  });
}

/** What the page shows for each tier: this week's pool and prizes, the table, the player's place. */
export async function tournamentView(db: DbOrTx, userId: string, now: Date) {
  const week = weekKey(now);
  return Promise.all(TOURNAMENT_TIERS.map(async (tier) => {
    const table = await standings(db, tier, week, now);
    const me = table.findIndex((r) => r.userId === userId);
    return { tier, ...TOURNAMENTS[tier], week, endsAt: weekEndsAt(week), players: table.length, pool: tournamentPool(table.length, tier), prizes: tournamentPrizes(table.length, tier), table: table.slice(0, 20), me: me >= 0 ? { place: me + 1, ...table[me]! } : null };
  }));
}

/**
 * The worker settles the week that ended, for each tier: the prizes to the
 * first places in ТрансКоин, or the fees back with too few players. Once per
 * week and tier.
 */
export async function settleTournament(db: Database, now = new Date()) {
  let n = 0;
  for (const tier of TOURNAMENT_TIERS) n += await settleTier(db, tier, now);
  return n;
}

async function settleTier(db: Database, tier: TournamentTier, now: Date) {
  const week = weekKey(new Date(now.getTime() - 7 * 86_400_000));
  if (now < weekEndsAt(week)) return 0;
  const def = TOURNAMENTS[tier];
  return db.transaction(async (tx) => {
    const [first] = await tx.insert(jobState).values({ key: `tourney-settled:${tier}:${week}`, value: { at: now.toISOString() }, updatedAt: now }).onConflictDoNothing().returning({ key: jobState.key });
    if (!first) return 0;
    const table = await standings(tx, tier, week, weekEndsAt(week));
    if (!table.length) return 0;
    if (table.length < TOURNAMENT.minPlayers) {
      for (const r of table) {
        await postCoins(tx, r.userId, { amount: def.feeCoins, reason: 'refund', description: t('{0} не се състоя — входът е върнат', t(def.label)), idempotencyKey: `tourney-refund:${tier}:${week}:${r.userId}` });
        await notify(tx, r.userId, 'info', () => t('{0} не се състоя', t(def.label)), () => t('Записаха се по-малко от {0} играчи — входът ти от {1} TC е върнат.', TOURNAMENT.minPlayers, def.feeCoins), '/game/tournament');
      }
      return table.length;
    }
    const prizes = tournamentPrizes(table.length, tier);
    for (const [i, r] of table.entries()) {
      const prize = prizes[i] ?? 0;
      if (prize > 0) await postCoins(tx, r.userId, { amount: prize, reason: 'tournament_prize', description: t('{0} — {1} място', t(def.label), i + 1), idempotencyKey: `tourney-prize:${tier}:${week}:${r.userId}` });
      await notify(tx, r.userId, prize > 0 ? 'achievement' : 'info', () => (prize > 0 ? t('{0} {1} място — {2}!', def.emoji, i + 1, t(def.label)) : t('{0} свърши', t(def.label))), () => (prize > 0 ? t('{0} т — наградата е {1} TC.', r.tons, prize) : t('Ти си {0} от {1} с {2} т. Новият турнир вече започна.', i + 1, table.length, r.tons)), '/game/tournament');
    }
    return table.length;
  });
}

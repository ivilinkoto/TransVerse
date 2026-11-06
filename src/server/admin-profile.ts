/**
 * 1.2.3.2: everything about one player in one place, for the admin panel
 * (/admin/users/[id] → „Пълна информация“). It ignores the player's „Скрий“
 * setting — the team always sees it. Real-money payments only for administrators.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { companies, inventoryItems, payments, seasonScores, users } from '@/server/db/schema';
import { businessCard } from '@/server/game/business-card';
import { playerCareer } from '@/server/game/career';
import { activeSeason } from '@/server/game/seasons';

export async function adminFullProfile(db: DbOrTx, userId: string, now: Date, admin: boolean) {
  const [u] = await db.select({ coins: users.coins, loginStreak: users.loginStreak, leagueTier: users.leagueTier, referredById: users.referredById, title: users.title, username: users.username }).from(users).where(eq(users.id, userId));
  if (!u) return null;
  const [account] = await db.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
  const season = await activeSeason(db, now);
  const [biz, career, [items], [invited], [inviter], [place], [paid]] = await Promise.all([
    businessCard(db, userId, now),
    playerCareer(db, userId),
    db.select({ kinds: sql<number>`count(*)::int`, qty: sql<number>`coalesce(sum(${inventoryItems.qty}), 0)::int` }).from(inventoryItems).where(and(eq(inventoryItems.userId, userId), sql`${inventoryItems.qty} > 0`)),
    db.select({ n: sql<number>`count(*)::int` }).from(users).where(eq(users.referredById, userId)),
    u.referredById ? db.select({ username: users.username }).from(users).where(eq(users.id, u.referredById)) : Promise.resolve([] as { username: string }[]),
    account
      ? db
          .select({
            points: seasonScores.points,
            rank: sql<number>`(select count(*)::int + 1 from ${seasonScores} s2 where s2.season_id = ${season.id} and s2.points > ${seasonScores.points})`,
          })
          .from(seasonScores)
          .where(and(eq(seasonScores.seasonId, season.id), eq(seasonScores.companyId, account.id)))
      : Promise.resolve([] as { points: number; rank: number }[]),
    admin
      ? db.select({ cents: sql<number>`coalesce(sum(${payments.amountCents}), 0)::int`, n: sql<number>`count(*)::int` }).from(payments).where(and(eq(payments.userId, userId), eq(payments.status, 'paid')))
      : Promise.resolve([] as { cents: number; n: number }[]),
  ]);
  return {
    coins: u.coins,
    loginStreak: u.loginStreak,
    leagueTier: u.leagueTier,
    title: u.title,
    business: biz,
    career: career ? { trips: career.trips, km: career.km, tons: career.tons, onTimeShare: career.onTimeShare, countries: career.countries, achievements: career.achievements } : null,
    items: { kinds: items?.kinds ?? 0, qty: items?.qty ?? 0 },
    invited: invited?.n ?? 0,
    invitedBy: inviter?.username ?? null,
    season: place ? { name: season.name, points: place.points, rank: place.rank } : { name: season.name, points: 0, rank: null as number | null },
    payments: admin ? { cents: paid?.cents ?? 0, count: paid?.n ?? 0 } : null,
  };
}

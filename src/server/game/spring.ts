import { and, asc, count, eq, gte, lt, sql } from 'drizzle-orm';
import { money } from '@/lib/format';
import { BADGES } from '@/lib/game/halloween';
import { sofiaMidnight } from '@/lib/game/missions';
import { isEquinox, isPassOpening, PASS_OPENING, SPRING } from '@/lib/game/spring';
import type { DbOrTx, Tx } from '@/server/db/client';
import { companies, deliveries, passOpenings, routes, userBadges, users } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { post } from './finance';
import { notify } from './notify';
import { t as tr } from '@/i18n/t';

const COUNTRY_BG: Record<string, string> = { AT: 'Австрия', RS: 'Сърбия', MK: 'Северна Македония', BG: 'България', RO: 'Румъния' };

/** The equinox window as instants (Sofia). */
export function equinoxWindow() {
  const [fm, fd] = SPRING.equinox.from.split('-').map(Number) as [number, number];
  const [tm, td] = SPRING.equinox.to.split('-').map(Number) as [number, number];
  return { from: sofiaMidnight(SPRING.year, fm, fd), to: sofiaMidnight(SPRING.year, tm, td + 1) };
}

/**
 * A delivery during the equinox: on time pays a little more (personal account,
 * before any treasury); the tenth such trip earns the badge.
 */
export async function equinoxBonus(tx: Tx, userId: string, d: { id: string; companyId: string }, f: { late: boolean; rewardCents: number }, at: Date) {
  if (f.late || !isEquinox(at) || !(await featureFor(tx, userId, 'spring', at))) return 0;
  const bonus = Math.round(f.rewardCents * SPRING.equinoxShare);
  if (bonus) await post(tx, d.companyId, [{ category: 'holiday_reward', amountCents: bonus, description: tr('Равноденствие: бонус за курс навреме'), idempotencyKey: `delivery:${d.id}:equinox`, refType: 'delivery', refId: d.id }]);
  const w = equinoxWindow();
  const [{ n = 0 } = {}] = await tx.select({ n: count() }).from(deliveries).where(and(eq(deliveries.companyId, d.companyId), eq(deliveries.status, 'completed'), eq(deliveries.late, false), gte(deliveries.completedAt, w.from), lt(deliveries.completedAt, w.to)));
  // This delivery is not marked completed yet: it counts as one more.
  if (n + 1 >= SPRING.equinoxBadgeTrips) {
    const [got] = await tx.insert(userBadges).values({ userId, badge: SPRING.equinoxBadge, awardedAt: at }).onConflictDoNothing().returning();
    if (got) await notify(tx, userId, 'achievement', () => tr('Значка: {0}', BADGES[SPRING.equinoxBadge]?.label ?? ''), () => tr('{0} курса навреме по време на равноденствието.', SPRING.equinoxBadgeTrips), '/game/spring');
  }
  return bonus;
}

/** After the winter: the first players through each mountain country this spring get a prize and a place in the chronicle. */
export async function recordPassOpening(tx: Tx, userId: string, d: { id: string; companyId: string; routeId: number }, late: boolean, at: Date) {
  if (late || !isPassOpening(at) || !(await featureFor(tx, userId, 'pass_opening', at))) return 0;
  const [route] = await tx.select({ countries: routes.countries }).from(routes).where(eq(routes.id, d.routeId));
  const year = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia', year: 'numeric' }).format(at));
  let paid = 0;
  for (const country of (route?.countries ?? []).filter((c) => PASS_OPENING.countries.includes(c))) {
    // One row per rank: a race between two trips gives each its own rank (the unique key decides).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pass-opening:${year}:${country}`}))`);
    const taken = await tx.select({ rank: passOpenings.rank, userId: passOpenings.userId }).from(passOpenings).where(and(eq(passOpenings.year, year), eq(passOpenings.country, country)));
    if (taken.length >= PASS_OPENING.firstN || taken.some((t) => t.userId === userId)) continue;
    const rank = taken.length + 1;
    await tx.insert(passOpenings).values({ year, country, rank, userId, deliveryId: d.id, at });
    await post(tx, d.companyId, [{ category: 'holiday_reward', amountCents: PASS_OPENING.prizeCents, description: tr('Отворени проходи: {0}. през {1}', rank, COUNTRY_BG[country] ?? country), idempotencyKey: `pass-opening:${year}:${country}:${userId}`, refType: 'delivery', refId: d.id }]);
    await notify(tx, userId, 'success', () => tr('Сред първите през проходите на {0}!', COUNTRY_BG[country] ?? country), () => tr('{0}. място тази пролет — {1}.', rank, money(PASS_OPENING.prizeCents)), '/game/spring');
    paid += PASS_OPENING.prizeCents;
  }
  return paid;
}

/** The passes' chronicle of a year, by country. */
export async function passChronicle(db: DbOrTx, year: number) {
  const rows = await db
    .select({ country: passOpenings.country, rank: passOpenings.rank, username: users.username, at: passOpenings.at })
    .from(passOpenings)
    .innerJoin(users, eq(users.id, passOpenings.userId))
    .where(eq(passOpenings.year, year))
    .orderBy(asc(passOpenings.country), asc(passOpenings.rank));
  return PASS_OPENING.countries.map((c) => ({ country: c, name: COUNTRY_BG[c] ?? c, first: rows.filter((r) => r.country === c) }));
}

/** The player's on-time trips during the equinox (for the badge). */
export async function equinoxTrips(db: DbOrTx, userId: string) {
  const w = equinoxWindow();
  const [row] = await db.select({ n: count() }).from(deliveries).innerJoin(companies, eq(companies.id, deliveries.companyId)).where(and(eq(companies.ownerId, userId), eq(deliveries.status, 'completed'), eq(deliveries.late, false), gte(deliveries.completedAt, w.from), lt(deliveries.completedAt, w.to)));
  return row?.n ?? 0;
}

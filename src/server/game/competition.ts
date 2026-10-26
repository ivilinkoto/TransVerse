import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { money } from '@/lib/format';
import { ALBUM, albumBadge, DIVISION_LABELS, DIVISION_RULES, DIVISIONS, divisionMoves, isPerfectTrip, nextDivision, PERFECT, PERFECT_ROLE_STREAK, perfectBonusShare, type Division } from '@/lib/game/competition';
import { periodWindow } from '@/lib/game/missions';
import { BADGES } from '@/lib/game/halloween';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, cityVisits, companyMembers, countries, divisionResults, jobState, organizations, userBadges, users } from '@/server/db/schema';
import { queueRoles } from '@/server/discord/outbox';
import { featureFor } from '@/server/features';
import { postCoins } from './coins';
import { postTreasury } from './finance';
import { notifyMembers } from './membership';
import { notify } from './notify';
import { addChronicle } from './chronicle';
import { t } from '@/i18n/t';

// ── Divisions ─────────────────────────────────────────────────────────────

/** Tonnes of each company's members between two times (the current members). */
async function companyTons(db: DbOrTx, from: Date, to: Date) {
  const { rows } = await db.execute<{ id: string; name: string; tag: string | null; division: string; tons: number }>(sql`
    select o.id, o.name, o.tag, o.division, coalesce(sum(c.weight_tons), 0)::float as tons
    from organizations o
    left join company_members m on m.company_id = o.id
    left join companies a on a.owner_id = m.user_id
    left join deliveries d on d.company_id = a.id and d.status = 'completed' and d.completed_at >= ${from} and d.completed_at < ${to}
    left join contracts c on c.id = d.contract_id
    group by o.id, o.name, o.tag, o.division`);
  return rows.map((r) => ({ ...r, tons: Number(r.tons), division: (DIVISIONS as readonly string[]).includes(r.division) ? (r.division as Division) : 'bronze' }));
}

/** The table of a division this month (best first). */
export async function divisionTable(db: DbOrTx, division: Division, now = new Date()) {
  const rows = (await companyTons(db, monthStart(now), periodWindow('monthly', now).endsAt)).filter((r) => r.division === division).sort((a, b) => b.tons - a.tons);
  const moves = divisionMoves(division, rows.length);
  return rows.map((r, i) => ({ ...r, rank: i + 1, move: moves[i]! }));
}

/** The start of the month that `now` is in (Sofia). */
function monthStart(now: Date) {
  const end = periodWindow('monthly', now).endsAt;
  // The previous month's end is this month's start.
  const back = new Date(end.getTime() - 32 * 86_400_000);
  return periodWindow('monthly', back).endsAt;
}

/** Worker: once a month closes the past month — prizes, up and down. */
export async function settleDivisions(db: Database, now = new Date()) {
  const thisStart = monthStart(now);
  const past = new Date(thisStart.getTime() - 86_400_000);
  const key = `divisions:${periodWindow('monthly', past).key}`;
  const [done] = await db.select().from(jobState).where(eq(jobState.key, key));
  if (done) return 0;
  const all = await companyTons(db, monthStart(past), thisStart);
  let moved = 0;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
    const [again] = await tx.select().from(jobState).where(eq(jobState.key, key));
    if (again) return;
    for (const division of DIVISIONS) {
      const table = all.filter((r) => r.division === division).sort((a, b) => b.tons - a.tons);
      const moves = divisionMoves(division, table.length);
      for (const [i, r] of table.entries()) {
        const move = r.tons > 0 ? moves[i]! : division === 'bronze' ? 'stay' : 'down';
        await tx.insert(divisionResults).values({ monthKey: periodWindow('monthly', past).key, organizationId: r.id, division, rank: i + 1, tons: r.tons, move }).onConflictDoNothing();
        const prize = r.tons > 0 ? DIVISION_RULES.prizes[division][i] : undefined;
        if (prize) await postTreasury(tx, r.id, [{ category: 'division', amountCents: prize, description: t('{0} дивизия: {1}. място', DIVISION_LABELS[division], i + 1), idempotencyKey: `${key}:${r.id}`, refType: 'division' }]);
        if (move !== 'stay') {
          await tx.update(organizations).set({ division: nextDivision(division, move) }).where(eq(organizations.id, r.id));
          moved++;
          // The members' division role in Discord follows.
          for (const m of await tx.select({ userId: companyMembers.userId }).from(companyMembers).where(eq(companyMembers.companyId, r.id))) await queueRoles(tx, m.userId, now);
        }
        if (move !== 'stay') await addChronicle(tx, r.id, 'division', move === 'up' ? `Качване в ${DIVISION_LABELS[nextDivision(division, 'up')].toLowerCase()}та дивизия` : `Слизане в ${DIVISION_LABELS[nextDivision(division, 'down')].toLowerCase()}та дивизия`, now);
        else if (prize) await addChronicle(tx, r.id, 'division', `${i + 1}. място в ${DIVISION_LABELS[division].toLowerCase()}та дивизия`, now);
        if (prize || move !== 'stay') await notifyMembers(tx, r.id, null, () => move === 'up' ? t('Качихте се в {0}та дивизия! ⬆', DIVISION_LABELS[nextDivision(division, 'up')].toLowerCase()) : move === 'down' ? t('Слизате в {0}та дивизия', DIVISION_LABELS[nextDivision(division, 'down')].toLowerCase()) : t('{0}. място в дивизията', i + 1), () => prize ? t('Награда: {0} в касата.', money(prize)) : t('Новият месец е нов шанс.'), '/game/leaderboards?tab=divisions');
      }
    }
    await tx.insert(jobState).values({ key, value: { moved } });
  });
  return moved;
}

// ── The perfect trip ──────────────────────────────────────────────────────

/**
 * A finished delivery: a perfect one grows the streak (a bonus on its
 * freight, badges at 5, 10 and 25), anything else ends it. Returns the bonus.
 */
export async function recordPerfectTrip(tx: Tx, userId: string, f: Parameters<typeof isPerfectTrip>[0] & { rewardCents: number }, now: Date): Promise<{ bonusCents: number; streak: number }> {
  if (!(await featureFor(tx, userId, 'perfect_run', now))) return { bonusCents: 0, streak: 0 };
  if (!isPerfectTrip(f)) {
    const [before] = await tx.select({ streak: users.perfectStreak }).from(users).where(eq(users.id, userId));
    await tx.update(users).set({ perfectStreak: 0 }).where(eq(users.id, userId));
    // The Discord role of a long streak goes with it.
    if ((before?.streak ?? 0) >= PERFECT_ROLE_STREAK) await queueRoles(tx, userId, now);
    return { bonusCents: 0, streak: 0 };
  }
  const [u] = await tx.update(users).set({ perfectStreak: sql`${users.perfectStreak} + 1`, bestPerfectStreak: sql`greatest(${users.bestPerfectStreak}, ${users.perfectStreak} + 1)` }).where(eq(users.id, userId)).returning({ streak: users.perfectStreak });
  const streak = u!.streak;
  if (streak === PERFECT_ROLE_STREAK) await queueRoles(tx, userId, now);
  for (const [n, badge] of PERFECT.badges) {
    if (streak !== n) continue;
    const [got] = await tx.insert(userBadges).values({ userId, badge }).onConflictDoNothing().returning();
    if (got) await notify(tx, userId, 'achievement', () => t('Значка: {0}', BADGES[badge]?.label ?? badge), () => t('{0} перфектни курса подред — навреме, без инцидент, без глоба, с пълен камион.', n), '/game/profile');
  }
  return { bonusCents: Math.round(f.rewardCents * perfectBonusShare(streak)), streak };
}

// ── The city album ────────────────────────────────────────────────────────

/** The album pages: the biggest market cities of each country. */
export async function albumCities(db: DbOrTx) {
  const { rows } = await db.execute<{ id: number; name: string; country: string; population: number }>(sql`
    select id, name, country, population from (
      select c.id, c.name_bg as name, c.country_code as country, c.population,
             row_number() over (partition by c.country_code order by c.population desc) as rn
      from cities c where exists (select 1 from city_markets m where m.city_id = c.id)
    ) x where rn <= ${ALBUM.citiesPerCountry} order by country, population desc`);
  return rows;
}

/** A delivery to a city: a new album card; a full country page earns ТрансКоин and the badge. */
export async function recordCityVisit(tx: Tx, userId: string, cityId: number, now: Date) {
  if (!(await featureFor(tx, userId, 'city_album', now))) return null;
  const [fresh] = await tx.insert(cityVisits).values({ userId, cityId, firstAt: now }).onConflictDoNothing().returning();
  if (!fresh) return null;
  const [city] = await tx.select({ country: cities.countryCode }).from(cities).where(eq(cities.id, cityId));
  if (!city) return null;
  const page = (await albumCities(tx)).filter((c) => c.country === city.country);
  if (!page.some((c) => c.id === cityId)) return null;
  const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(cityVisits).where(and(eq(cityVisits.userId, userId), inArray(cityVisits.cityId, page.map((c) => c.id))));
  if (n < page.length) return { country: city.country, have: n, of: page.length };
  const badge = albumBadge(city.country);
  const [got] = await tx.insert(userBadges).values({ userId, badge }).onConflictDoNothing().returning();
  if (got) {
    await postCoins(tx, userId, { amount: ALBUM.coins, reason: 'holiday_reward', description: t('Пълен албум: {0}', BADGES[badge]?.label ?? city.country), idempotencyKey: `album:${userId}:${city.country}` });
    await notify(tx, userId, 'achievement', () => t('Пълен албум! {0}', BADGES[badge]?.label ?? ''), () => t('Доставил си до всичките {0} най-големи града — {1} TC и значка.', page.length, ALBUM.coins), '/game/collection');
  }
  return { country: city.country, have: n, of: page.length };
}

/** The player's album: every country page with the cities and which are collected. */
export async function albumOf(db: DbOrTx, userId: string) {
  const [all, visits, names] = await Promise.all([
    albumCities(db),
    db.select({ cityId: cityVisits.cityId, at: cityVisits.firstAt }).from(cityVisits).where(eq(cityVisits.userId, userId)),
    db.select({ code: countries.code, name: countries.nameBg }).from(countries).orderBy(asc(countries.nameBg)),
  ]);
  const got = new Map(visits.map((v) => [v.cityId, v.at]));
  return names
    .map((c) => ({ code: c.code, name: c.name, cities: all.filter((x) => x.country === c.code).map((x) => ({ id: x.id, name: x.name, at: got.get(x.id) ?? null })) }))
    .filter((p) => p.cities.length > 0);
}


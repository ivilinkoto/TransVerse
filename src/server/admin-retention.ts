import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import type { Database, DbOrTx } from '@/server/db/client';
import { companies, users } from '@/server/db/schema';
import { recordAudit, requireStaff, type Staff } from '@/server/admin';
import { postCoins } from '@/server/game/coins';
import { fail } from '@/server/game/errors';
import { notify } from '@/server/game/notify';
import { layoutMail, mailConfig, sendMail } from '@/server/mail';
import { appUrl } from '@/server/discord/config';
import { t } from '@/i18n/t';

/**
 * 1.1.4.1, the admin panel: does the game keep its players? Weekly groups by
 * sign-up and how many came back on or after day 1, 7 and 30 (by the last
 * time they were in the game). Players only, not the team.
 */
export async function retentionCohorts(db: DbOrTx, now: Date, weeks = 8) {
  const since = new Date(now.getTime() - weeks * 7 * 86_400_000);
  const rows = await db.execute<{ week: string; size: number; d1: number; d7: number; d30: number }>(sql`
    select to_char(date_trunc('week', ${users.createdAt} at time zone 'Europe/Sofia'), 'YYYY-MM-DD') as week,
      count(*)::int as size,
      count(*) filter (where ${users.lastSeenAt} >= ${users.createdAt} + interval '1 day')::int as d1,
      count(*) filter (where ${users.lastSeenAt} >= ${users.createdAt} + interval '7 days')::int as d7,
      count(*) filter (where ${users.lastSeenAt} >= ${users.createdAt} + interval '30 days')::int as d30
    from ${users}
    where ${users.createdAt} >= ${since} and ${users.role} = 'player'
    group by 1 order by 1 desc`);
  // A day N is only counted once the whole week is N days old.
  return rows.rows.map((r) => {
    const age = (now.getTime() - new Date(`${r.week}T00:00:00+02:00`).getTime()) / 86_400_000;
    return { ...r, d1: age >= 8 ? r.d1 : null, d7: age >= 14 ? r.d7 : null, d30: age >= 37 ? r.d30 : null };
  });
}

/** The last days: new players, players who were in the game, trips finished. */
export async function dailyActivity(db: DbOrTx, now: Date, days = 14) {
  const since = new Date(now.getTime() - days * 86_400_000);
  const rows = await db.execute<{ day: string; signups: number; active: number; trips: number }>(sql`
    with d as (select generate_series(date_trunc('day', ${since}::timestamptz at time zone 'Europe/Sofia'), date_trunc('day', ${now}::timestamptz at time zone 'Europe/Sofia'), interval '1 day') as day)
    select to_char(d.day, 'YYYY-MM-DD') as day,
      (select count(*) from users u where u.role = 'player' and date_trunc('day', u.created_at at time zone 'Europe/Sofia') = d.day)::int as signups,
      (select count(distinct a.user_id) from activity a where date_trunc('day', a.created_at at time zone 'Europe/Sofia') = d.day)::int as active,
      (select count(*) from deliveries x where x.status = 'completed' and date_trunc('day', x.completed_at at time zone 'Europe/Sofia') = d.day)::int as trips
    from d order by d.day`);
  return rows.rows;
}

/** Players who stopped coming: last seen 3 to 30 days ago (newest first). */
export async function missingPlayers(db: DbOrTx, now: Date, limit = 50) {
  return db
    .select({ id: users.id, username: users.username, level: users.level, lastSeenAt: users.lastSeenAt, createdAt: users.createdAt, email: users.email, verified: users.emailVerifiedAt, deliveries: companies.deliveries })
    .from(users)
    .leftJoin(companies, eq(companies.ownerId, users.id))
    .where(and(eq(users.role, 'player'), isNull(users.bannedAt), lte(users.lastSeenAt, new Date(now.getTime() - 3 * 86_400_000)), gte(users.lastSeenAt, new Date(now.getTime() - 30 * 86_400_000))))
    .orderBy(desc(users.lastSeenAt))
    .limit(limit);
}

export const WIN_BACK_COINS = 10;

/** „Покани обратно“: a notification, an email (when it can be sent) and a small gift — once a month per player. */
export async function winBack(db: Database, actor: Staff | null, userId: string, now = new Date()) {
  requireStaff(actor);
  const [u] = await db.select({ id: users.id, username: users.username, email: users.email, verified: users.emailVerifiedAt }).from(users).where(eq(users.id, userId));
  if (!u) fail('user_not_found', t('Потребителят не е намерен.'), 404);
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit' }).format(now);
  const gift = await db.transaction((tx) => postCoins(tx, u!.id, { amount: WIN_BACK_COINS, reason: 'admin_grant', description: t('Добре дошъл обратно'), idempotencyKey: `winback:${u!.id}:${month}`, actorUserId: actor.id }));
  if (!gift) fail('already_invited', t('Този месец вече е поканен.'));
  await notify(db, u!.id, 'info', () => t('Липсваш ни на пътя! 🚚'), () => t('Подарък: {0} ТрансКоин. Камионите те чакат.', WIN_BACK_COINS), '/game');
  let mailed = false;
  if (u!.verified && mailConfig().enabled) {
    mailed = await sendMail({ ...layoutMail({ to: u!.email, subject: t('Липсваш ни в TransVerse'), heading: t('Камионите те чакат, {0}', u!.username), lines: [t('Подарихме ти {0} ТрансКоин — влез и ги вземи.', WIN_BACK_COINS)], button: { label: t('Към играта'), url: `${appUrl()}/game` }, footer: t('Получаваш това писмо, защото имаш профил в TransVerse.') }), kind: 'win_back', userId: u!.id }, 'win_back', u!.id);
  }
  await recordAudit(db, actor.id, 'win_back', u!.id, { coins: WIN_BACK_COINS, mailed });
  return { mailed };
}

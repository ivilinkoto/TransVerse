import { sql } from 'drizzle-orm';
import { dec, int, km } from '@/lib/format';
import { periodWindow } from '@/lib/game/missions';
import type { Database } from '@/server/db/client';
import { appUrl, BRAND, discordConfig } from './config';
import { announce } from './outbox';
import { t } from '@/i18n/t';

/**
 * "Най-добрите на седмицата" in #класации every Sunday from 20:00 (Sofia):
 * drivers and companies with the most deliveries since Monday, the longest
 * trip and the week in numbers. Game data, announced once per week.
 */

const medal = (i: number) => ['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`;
const sofiaHour = (now: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', hour: '2-digit', hourCycle: 'h23' }).format(now));
const sofiaWeekday = (now: Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Sofia', weekday: 'short' }).format(now);

export async function weeklyRanking(db: Database, now = new Date()) {
  const week = periodWindow('weekly', now);
  const since = new Date(week.endsAt.getTime() - 7 * 86_400_000);
  const done = sql`d.status = 'completed' and d.completed_at >= ${since} and d.completed_at <= ${now}`;
  const drivers = await db.execute<{ username: string; n: number; tons: number }>(sql`
    select u.username, count(*)::int as n, coalesce(sum(c.weight_tons), 0)::float as tons
    from deliveries d join companies co on co.id = d.company_id join users u on u.id = co.owner_id join contracts c on c.id = d.contract_id
    where ${done} and u.banned_at is null
    group by u.username order by n desc, tons desc limit 5`);
  const orgs = await db.execute<{ name: string; tag: string | null; n: number }>(sql`
    select o.name, o.tag, count(*)::int as n
    from deliveries d join companies co on co.id = d.company_id join company_members m on m.user_id = co.owner_id join organizations o on o.id = m.company_id
    where ${done}
    group by o.id, o.name, o.tag order by n desc limit 5`);
  const longest = await db.execute<{ username: string; from: string; to: string; km: number }>(sql`
    select u.username, oc.name_bg as "from", dc.name_bg as "to", d.loaded_km::float as km
    from deliveries d join companies co on co.id = d.company_id join users u on u.id = co.owner_id join contracts c on c.id = d.contract_id
      join cities oc on oc.id = c.origin_city_id join cities dc on dc.id = c.dest_city_id
    where ${done} order by d.loaded_km desc limit 1`);
  const totals = await db.execute<{ n: number; km: number; tons: number }>(sql`
    select count(*)::int as n, coalesce(sum(d.loaded_km + d.empty_km), 0)::float as km, coalesce(sum(c.weight_tons), 0)::float as tons
    from deliveries d join contracts c on c.id = d.contract_id where ${done}`);
  return { key: week.key, drivers: drivers.rows, orgs: orgs.rows, longest: longest.rows[0] ?? null, totals: totals.rows[0] ?? { n: 0, km: 0, tons: 0 } };
}

/** Worker: on Sunday evening, once. */
export async function announceWeeklyRanking(db: Database, now = new Date()) {
  if (!discordConfig().bot || sofiaWeekday(now) !== 'Sun' || sofiaHour(now) < 20) return false;
  const w = await weeklyRanking(db, now);
  if (!w.totals.n) return false;
  await announce(db, `weekly-ranking:${w.key}`, 'rankings', () => ({
    embeds: [{
      title: t('🏆 Най-добрите на седмицата'),
      url: `${appUrl()}/game/leaderboards`,
      color: BRAND,
      description: t('{0} курса · {1} · {2} т', int(w.totals.n), km(w.totals.km), int(Math.round(w.totals.tons))),
      fields: [
        { name: t('🚚 Шофьори'), value: w.drivers.map((d, i) => t('{0} **{1}** · {2} курса · {3} т', medal(i), d.username, d.n, dec(d.tons))).join('\n') || '—' },
        { name: t('🏢 Компании'), value: w.orgs.map((o, i) => t('{0} **{1}**{2} · {3} курса', medal(i), o.name, o.tag ? ` [${o.tag}]` : '', o.n)).join('\n') || '—' },
        ...(w.longest ? [{ name: t('🛣️ Най-дълъг курс'), value: `**${w.longest.username}**: ${w.longest.from} → ${w.longest.to}, ${km(w.longest.km)}` }] : []),
      ],
      footer: { text: t('От понеделник до неделя вечер · игрови данни') },
    }],
  }), now);
  return true;
}

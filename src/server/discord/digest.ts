import { sql } from 'drizzle-orm';
import { dec, int, km } from '@/lib/format';
import { featureLive } from '@/lib/game/features';
import { periodWindow } from '@/lib/game/missions';
import type { Database } from '@/server/db/client';
import { appUrl, BRAND, discordConfig } from './config';
import { announce } from './outbox';

/**
 * The weekly digest (v1.5): every Monday from 10:00 (Sofia), in #седмичник,
 * a short show of last week — the numbers, records, new companies, what
 * happened on the road, the rally and the ships. Game data.
 */

const sofiaHour = (now: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', hour: '2-digit', hourCycle: 'h23' }).format(now));
const sofiaWeekday = (now: Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Sofia', weekday: 'short' }).format(now);

const EVENT_WORDS: Record<string, string> = { breakdown: 'повреди', police: 'полицейски проверки', ghost: 'срещи с призрачния камион', snow: 'снеговалежи', ice: 'заледявания', border_queue: 'опашки на границата', traffic: 'задръствания' };

export async function weeklyDigest(db: Database, now = new Date()) {
  const thisWeek = periodWindow('weekly', now);
  const to = new Date(thisWeek.endsAt.getTime() - 7 * 86_400_000);
  const from = new Date(to.getTime() - 7 * 86_400_000);
  const done = sql`d.status = 'completed' and d.completed_at >= ${from} and d.completed_at < ${to}`;
  const { rows: [totals] } = await db.execute<{ n: number; km: number; tons: number; drivers: number }>(sql`
    select count(*)::int as n, coalesce(sum(d.loaded_km + d.empty_km), 0)::float as km, coalesce(sum(c.weight_tons), 0)::float as tons, count(distinct d.company_id)::int as drivers
    from deliveries d join contracts c on c.id = d.contract_id where ${done}`);
  const { rows: [heaviest] } = await db.execute<{ username: string; goods: string; tons: number }>(sql`
    select u.username, c.goods, c.weight_tons::float as tons from deliveries d join contracts c on c.id = d.contract_id join companies co on co.id = d.company_id join users u on u.id = co.owner_id
    where ${done} order by c.weight_tons desc limit 1`);
  const { rows: [longest] } = await db.execute<{ username: string; from: string; to: string; km: number }>(sql`
    select u.username, oc.name_bg as "from", dc.name_bg as "to", d.loaded_km::float as km
    from deliveries d join contracts c on c.id = d.contract_id join companies co on co.id = d.company_id join users u on u.id = co.owner_id
      join cities oc on oc.id = c.origin_city_id join cities dc on dc.id = c.dest_city_id
    where ${done} order by d.loaded_km desc limit 1`);
  const { rows: fresh } = await db.execute<{ name: string; tag: string | null }>(sql`select name, tag from organizations where created_at >= ${from} and created_at < ${to} order by created_at limit 6`);
  const { rows: events } = await db.execute<{ kind: string; n: number }>(sql`
    select e->>'kind' as kind, count(*)::int as n from deliveries d, jsonb_array_elements(d.road_events) e
    where ${done} group by e->>'kind' order by count(*) desc`);
  const { rows: ships } = await db.execute<{ ship: string; containers: number; winner: string | null }>(sql`
    select s.ship, s.containers, o.name as winner from ship_calls s left join organizations o on o.id = s.winner_organization_id
    where s.status = 'done' and s.ends_at >= ${from} and s.ends_at < ${to} limit 3`);
  return { key: periodWindow('weekly', from).key, totals: totals!, heaviest: heaviest ?? null, longest: longest ?? null, fresh, events, ships };
}

/** Worker: on Monday morning, once a week. */
export async function announceWeeklyDigest(db: Database, now = new Date()) {
  if (!discordConfig().bot || !featureLive('weekly_digest', now) || sofiaWeekday(now) !== 'Mon' || sofiaHour(now) < 10) return false;
  const d = await weeklyDigest(db, now);
  if (!d.totals.n) return false;
  const happenings = d.events.filter((e) => EVENT_WORDS[e.kind]).slice(0, 4).map((e) => `${int(e.n)} ${EVENT_WORDS[e.kind]}`).join(', ');
  const lines = [
    `Добро утро, шофьори! Миналата седмица по пътищата на TransVerse: **${int(d.totals.n)} курса**, **${km(d.totals.km)}** и **${int(Math.round(d.totals.tons))} т** товари от ${int(d.totals.drivers)} шофьори.`,
    d.longest ? `🛣️ Най-дългият курс: **${d.longest.username}**, ${d.longest.from} → ${d.longest.to} (${km(d.longest.km)}).` : '',
    d.heaviest ? `🏋️ Най-тежкият товар: **${d.heaviest.username}** с ${dec(d.heaviest.tons)} т ${d.heaviest.goods.toLowerCase()}.` : '',
    d.fresh.length ? `🏢 Нови компании: ${d.fresh.map((o) => `**${o.name}**${o.tag ? ` [${o.tag}]` : ''}`).join(', ')} — добре дошли!` : '',
    happenings ? `🚧 На пътя се случиха ${happenings}.` : '',
    ...d.ships.map((s) => `🚢 ${s.ship}: ${s.containers} контейнера${s.winner ? ` — най-много разкара „${s.winner}“` : ''}.`),
    'Приятно каране тази седмица! 🚚',
  ].filter(Boolean);
  await announce(db, `weekly-digest:${d.key}`, 'news', {
    embeds: [{ title: '🎙️ Седмицата в TransVerse', url: `${appUrl()}/game/news`, color: BRAND, description: lines.join('\n\n'), footer: { text: 'Седмичен обзор · игрови данни' } }],
  }, now);
  return true;
}

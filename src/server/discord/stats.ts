import { sql } from 'drizzle-orm';
import { ONLINE_MS } from '@/lib/game/social';
import { int } from '@/lib/format';
import type { Database } from '@/server/db/client';
import { discord } from './api';
import { discordConfig } from './config';
import { guild } from './guild';
import { layoutState, type StatChannel } from './layout';

/**
 * The voice channels of "📊 СТАТИСТИКА": their names show live numbers from
 * the game (game data). Discord allows two renames of a channel per ten
 * minutes, so the worker renames only when a number changed, every ten.
 */
export async function statNames(db: Database, now = new Date()): Promise<Record<StatChannel, string>> {
  const { rows } = await db.execute<{ online: number; road: number; players: number; companies: number }>(sql`
    select
      (select count(*) from users where last_seen_at > ${new Date(now.getTime() - ONLINE_MS)} and banned_at is null)::int as online,
      (select count(*) from deliveries where status = 'in_progress')::int as road,
      (select count(*) from users where banned_at is null)::int as players,
      (select count(*) from organizations)::int as companies`);
  const r = rows[0] ?? { online: 0, road: 0, players: 0, companies: 0 };
  return {
    'stat-online': `🟢 Онлайн: ${int(Number(r.online))}`,
    'stat-road': `🚚 На пътя: ${int(Number(r.road))}`,
    'stat-players': `👥 Шофьори: ${int(Number(r.players))}`,
    'stat-companies': `🏢 Компании: ${int(Number(r.companies))}`,
  };
}

export async function updateStats(db: Database, now = new Date()) {
  if (!discordConfig().bot) return 0;
  const state = await layoutState(db);
  const names = await statNames(db, now);
  const { channels } = await guild(true);
  let renamed = 0;
  for (const [key, name] of Object.entries(names) as [StatChannel, string][]) {
    const id = state.channels[key];
    const ch = id ? channels.find((c) => c.id === id) : undefined;
    if (!ch || ch.name === name) continue;
    await discord('PATCH', `/channels/${id}`, { name });
    renamed++;
  }
  return renamed;
}

import { sql } from 'drizzle-orm';
import { ONLINE_MS } from '@/lib/game/social';
import { int } from '@/lib/format';
import type { Database } from '@/server/db/client';
import { discord } from './api';
import { discordConfig } from './config';
import { guild } from './guild';
import { layoutState, type StatChannel } from './layout';
import { t } from '@/i18n/t';
import { featureLive } from '@/lib/game/features';
import { comingReleases } from '@/lib/game/releases';

/** 1.1.3.4: how long until the next update (days, or hours on the last day). */
export function nextUpdateName(now: Date) {
  const next = featureLive('discord_plus', now) ? comingReleases(now)[0] : undefined;
  if (!next) return t('🆕 Следва: скоро');
  const ms = new Date(next.publishedAt).getTime() - now.getTime();
  const hours = Math.max(1, Math.ceil(ms / 3_600_000));
  return hours < 24 ? t('🆕 {0} след {1} ч', next.version, hours) : t('🆕 {0} след {1} дни', next.version, Math.ceil(ms / 86_400_000));
}

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
    'stat-online': t('🟢 Онлайн: {0}', int(Number(r.online))),
    'stat-road': t('🚚 На пътя: {0}', int(Number(r.road))),
    'stat-players': t('👥 Шофьори: {0}', int(Number(r.players))),
    'stat-companies': t('🏢 Компании: {0}', int(Number(r.companies))),
    'stat-next': nextUpdateName(now),
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

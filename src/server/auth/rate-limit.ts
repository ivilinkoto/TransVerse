import { sql } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { GameError } from '@/server/game/errors';
import { t } from '@/i18n/t';

/**
 * Fixed-window rate limit stored in Postgres (works across processes).
 * Throws when the caller exceeded `limit` hits within `windowSeconds`.
 */
export async function rateLimit(db: DbOrTx, key: string, limit: number, windowSeconds: number): Promise<void> {
  const result = await db.execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count) values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then now() else rate_limits.window_start end
    returning count`);
  const count = Number(result.rows[0]?.count ?? 0);
  if (count > limit) throw new GameError('rate_limited', t('Твърде много опити. Опитайте отново след малко.'), 429);
}

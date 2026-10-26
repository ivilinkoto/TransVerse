import { and, desc, gt, isNull } from 'drizzle-orm';
import { Users } from 'lucide-react';
import { PlayerName } from '@/components/game/PlayerName';
import { ONLINE_MS } from '@/lib/game/social';
import { isVip } from '@/lib/game/vip';
import type { DbOrTx } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { t } from '@/i18n/t';

const SHOWN = 8;

/** v1.1.1: who is in the game right now (the dashboard). Names open the player card. */
export async function OnlineNow({ db, now }: { db: DbOrTx; now: Date }) {
  const rows = await db
    .select({ username: users.username, role: users.role, vipUntil: users.vipUntil })
    .from(users)
    .where(and(gt(users.lastSeenAt, new Date(now.getTime() - ONLINE_MS)), isNull(users.bannedAt)))
    .orderBy(desc(users.lastSeenAt))
    .limit(50);
  if (rows.length < 2) return null;
  return (
    <section className="panel flex items-start gap-3 p-3.5" aria-label={t('Онлайн сега')}>
      <span className="relative mt-0.5 shrink-0">
        <Users className="h-6 w-6 text-profit" />
        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-profit" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{t('Онлайн сега: {0}', rows.length)}</div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-mist-300">
          {rows.slice(0, SHOWN).map((r) => <PlayerName key={r.username} name={r.username} role={r.role === 'player' ? null : r.role} vip={isVip(r.vipUntil, now)} />)}
          {rows.length > SHOWN && <span className="text-mist-400">{t('и още {0}', rows.length - SHOWN)}</span>}
        </div>
      </div>
    </section>
  );
}

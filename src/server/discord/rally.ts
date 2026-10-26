import { eq } from 'drizzle-orm';
import { money } from '@/lib/format';
import { featureLive } from '@/lib/game/features';
import { RALLY } from '@/lib/game/rally';
import type { Database, DbOrTx } from '@/server/db/client';
import { jobState } from '@/server/db/schema';
import { activeRally, rallyResults } from '@/server/game/rally';
import { discord } from './api';
import { appUrl, discordConfig } from './config';
import { layoutChannel } from './layout';
import { announce } from './outbox';
import { t } from '@/i18n/t';

/**
 * The weekly rally in Discord (v1.5): one live message in #рали with the
 * fastest and the most economical (edited every ten minutes), a line for
 * every finish, and a voice channel "Рали — на живо" next to it.
 */

const hm = (min: number) => t('{0} ч {1} мин', Math.floor(min / 60), String(min % 60).padStart(2, '0'));
const medal = (i: number) => ['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`;

/** A run arrived: one line in #рали (from the settlement transaction, through the outbox). */
export async function announceRallyFinish(db: DbOrTx, entryKey: string, f: { username: string; minutes: number; fuelCentsPer100: number; from: string; to: string }, now: Date) {
  if (!featureLive('discord_rally', now)) return;
  await announce(db, `rally-finish:${entryKey}`, 'rally', () => ({ content: t('🏁 **{0}** финишира {1} → {2}: {3} · {4}/100 км', f.username, f.from, f.to, hm(f.minutes), money(f.fuelCentsPer100)), ping: false }), now);
}

/** Worker: the live board of the running rally. */
export async function liveRally(db: Database, now = new Date()) {
  if (!discordConfig().bot || !featureLive('discord_rally', now)) return 0;
  const rally = await activeRally(db);
  if (!rally) return 0;
  const results = await rallyResults(db, rally.id);
  const message = {
    embeds: [{
      title: t('🏁 Рали: {0} → {1}', rally.from, rally.to),
      url: `${appUrl()}/game/rally`,
      color: 0xf97316,
      description: t('{0} км · записани {1} · край <t:{2}:R>\nНаграда за първите трима: до {3} и {4} TC.', Math.round(rally.distanceKm), results.entries, Math.floor(rally.endsAt.getTime() / 1000), money(RALLY.prizes[0].cents), RALLY.prizes[0].coins),
      fields: [
        { name: t('Най-бързи'), value: results.fastest.slice(0, 5).map((r, i) => `${medal(i)} ${r.username} · ${hm(r.minutes)}`).join('\n') || t('Още никой не е финиширал.'), inline: true },
        { name: t('Най-икономични'), value: results.eco.slice(0, 5).map((r, i) => t('{0} {1} · {2}/100 км', medal(i), r.username, money(r.fuelCentsPer100))).join('\n') || '—', inline: true },
      ],
      footer: { text: t('TransVerse · игрови данни') },
    }],
    allowed_mentions: { parse: [] },
  };
  const key = `rally-live:${rally.id}`;
  const [state] = await db.select().from(jobState).where(eq(jobState.key, key));
  const saved = state?.value as { channelId: string; messageId: string } | undefined;
  if (saved) {
    await discord('PATCH', `/channels/${saved.channelId}/messages/${saved.messageId}`, message).catch(() => undefined);
    return 1;
  }
  const channelId = await layoutChannel(db, t('рали'));
  if (!channelId) return 0;
  const msg = await discord<{ id: string }>('POST', `/channels/${channelId}/messages`, message);
  await db.insert(jobState).values({ key, value: { channelId, messageId: msg.id } }).onConflictDoNothing();
  return 1;
}

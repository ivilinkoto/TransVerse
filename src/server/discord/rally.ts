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

/**
 * The weekly rally in Discord (v1.5): one live message in #рали with the
 * fastest and the most economical (edited every ten minutes), a line for
 * every finish, and a voice channel "Рали — на живо" next to it.
 */

const hm = (min: number) => `${Math.floor(min / 60)} ч ${String(min % 60).padStart(2, '0')} мин`;
const medal = (i: number) => ['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`;

/** A run arrived: one line in #рали (from the settlement transaction, through the outbox). */
export async function announceRallyFinish(db: DbOrTx, entryKey: string, f: { username: string; minutes: number; fuelCentsPer100: number; from: string; to: string }, now: Date) {
  if (!featureLive('discord_rally', now)) return;
  await announce(db, `rally-finish:${entryKey}`, 'rally', { content: `🏁 **${f.username}** финишира ${f.from} → ${f.to}: ${hm(f.minutes)} · ${money(f.fuelCentsPer100)}/100 км`, ping: false }, now);
}

/** Worker: the live board of the running rally. */
export async function liveRally(db: Database, now = new Date()) {
  if (!discordConfig().bot || !featureLive('discord_rally', now)) return 0;
  const rally = await activeRally(db);
  if (!rally) return 0;
  const results = await rallyResults(db, rally.id);
  const message = {
    embeds: [{
      title: `🏁 Рали: ${rally.from} → ${rally.to}`,
      url: `${appUrl()}/game/rally`,
      color: 0xf97316,
      description: `${Math.round(rally.distanceKm)} км · записани ${results.entries} · край <t:${Math.floor(rally.endsAt.getTime() / 1000)}:R>\nНаграда за първите трима: до ${money(RALLY.prizes[0].cents)} и ${RALLY.prizes[0].coins} TC.`,
      fields: [
        { name: 'Най-бързи', value: results.fastest.slice(0, 5).map((r, i) => `${medal(i)} ${r.username} · ${hm(r.minutes)}`).join('\n') || 'Още никой не е финиширал.', inline: true },
        { name: 'Най-икономични', value: results.eco.slice(0, 5).map((r, i) => `${medal(i)} ${r.username} · ${money(r.fuelCentsPer100)}/100 км`).join('\n') || '—', inline: true },
      ],
      footer: { text: 'TransVerse · игрови данни' },
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
  const channelId = await layoutChannel(db, 'рали');
  if (!channelId) return 0;
  const msg = await discord<{ id: string }>('POST', `/channels/${channelId}/messages`, message);
  await db.insert(jobState).values({ key, value: { channelId, messageId: msg.id } }).onConflictDoNothing();
  return 1;
}

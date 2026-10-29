import { eq, lt, sql } from 'drizzle-orm';
import type { Database } from '@/server/db/client';
import { discordTempRooms, discordVoice } from '@/server/db/schema';
import { discord, DiscordError } from './api';
import { discordConfig } from './config';
import { layoutCategory, layoutState } from './layout';
import { setVoice } from './levels';
import { t } from '@/i18n/t';

/**
 * "➕ Създай стая": who joins it gets their own voice channel (they may
 * rename it, limit it and move people) and is moved there; the room goes
 * when the last one leaves.
 */

const VIEW = 1n << 10n;
const MANAGE_CHANNELS = 1n << 4n;
const CONNECT = 1n << 20n;
const SPEAK = 1n << 21n;
const MOVE = 1n << 24n;
const bits = (...b: bigint[]) => b.reduce((a, x) => a | x, 0n).toString();
const EMPTY_GRACE_MS = 60_000;

/** The gateway's voice update: who is where, a new room when needed, empty rooms removed. */
export async function voiceChanged(db: Database, d: { user_id: string; channel_id: string | null; member?: { user?: { username?: string; global_name?: string | null; bot?: boolean } } }, now = new Date()) {
  if (d.member?.user?.bot) return;
  const [before] = await db.select({ channelId: discordVoice.channelId }).from(discordVoice).where(eq(discordVoice.discordUserId, d.user_id));
  await setVoice(db, d.user_id, d.channel_id, now);
  const state = await layoutState(db);
  if (d.channel_id && d.channel_id === state.channels['създай-стая']) await createRoom(db, d.user_id, d.member?.user?.global_name || d.member?.user?.username || t('шофьор'), now);
  if (before?.channelId && before.channelId !== d.channel_id) await removeIfEmpty(db, before.channelId);
}

async function createRoom(db: Database, discordId: string, name: string, now: Date) {
  const { guildId } = discordConfig();
  const parent = await layoutCategory(db, 'гласови', 'Гласови канали');
  const room = await discord<{ id: string }>('POST', `/guilds/${guildId}/channels`, {
    name: t('🔊 Стаята на {0}', name).slice(0, 100),
    type: 2,
    ...(parent ? { parent_id: parent } : {}),
    permission_overwrites: [{ id: discordId, type: 1, allow: bits(VIEW, CONNECT, SPEAK, MANAGE_CHANNELS, MOVE), deny: '0' }],
  });
  await db.insert(discordTempRooms).values({ channelId: room.id, ownerDiscordId: discordId, createdAt: now });
  // Move the member into the new room.
  await discord('PATCH', `/guilds/${guildId}/members/${discordId}`, { channel_id: room.id });
}

async function removeIfEmpty(db: Database, channelId: string) {
  const [room] = await db.select().from(discordTempRooms).where(eq(discordTempRooms.channelId, channelId));
  if (!room) return false;
  const [{ n = 0 } = {}] = await db.select({ n: sql<number>`count(*)::int` }).from(discordVoice).where(eq(discordVoice.channelId, channelId));
  if (n > 0) return false;
  await discord('DELETE', `/channels/${channelId}`).catch((e) => {
    if (!(e instanceof DiscordError && e.status === 404)) throw e;
  });
  await db.delete(discordTempRooms).where(eq(discordTempRooms.channelId, channelId));
  return true;
}

/** Worker: rooms that stayed empty (a missed event, a restart) are removed too. */
export async function sweepRooms(db: Database, now = new Date()) {
  if (!discordConfig().bot) return 0;
  const old = await db.select().from(discordTempRooms).where(lt(discordTempRooms.createdAt, new Date(now.getTime() - EMPTY_GRACE_MS)));
  let removed = 0;
  for (const r of old) if (await removeIfEmpty(db, r.channelId)) removed++;
  return removed;
}

import { eq } from 'drizzle-orm';
import type { Database } from '@/server/db/client';
import { jobState } from '@/server/db/schema';
import { discord, DiscordError } from './api';
import { discordConfig } from './config';
import { guild, isForumType, pinPosted, postIn, postTitle, removePosted, type Posted } from './guild';
import { layoutChannel } from './layout';

/**
 * 1.1.4.2: one live card per channel (#статус, #класации), edited in place.
 *
 * Before, any error on the edit (an archived forum post, a missing permission,
 * a lost id) made the bot delete the card and post a new one — every tick, so
 * the channel showed a "new" message and an unread badge every few minutes.
 * Now a new card is posted only when the old one is really gone, and first the
 * channel is searched for the bot's existing card (a lost id, a second server
 * with the same bot): that one is edited and any duplicates are removed.
 */
export type CardState = Posted & Record<string, unknown>;

const codeOf = (e: unknown) => (e instanceof DiscordError ? Number(/"code":\s*(\d+)/.exec(e.message)?.[1] ?? 0) : 0);
/** Unknown message / channel / thread: the card is gone. */
const gone = (e: unknown) => e instanceof DiscordError && (e.status === 404 || [10003, 10008].includes(codeOf(e)));
/** The forum post was archived (or locked) — open it again and edit. */
const archived = (e: unknown) => codeOf(e) === 50083;

async function edit(state: Posted, message: Record<string, unknown>) {
  try {
    await discord('PATCH', `/channels/${state.channelId}/messages/${state.messageId}`, message);
  } catch (e) {
    if (!archived(e)) throw e;
    await discord('PATCH', `/channels/${state.channelId}`, { archived: false, locked: false });
    await discord('PATCH', `/channels/${state.channelId}/messages/${state.messageId}`, message);
  }
}

/** The bot's own cards with this title in the channel (newest first). */
async function findCards(channelId: string, title: string): Promise<Posted[]> {
  const { channels, botId } = await guild();
  const ch = channels.find((c) => c.id === channelId);
  if (isForumType(ch?.type)) {
    const { threads = [] } = await discord<{ threads?: { id: string; parent_id?: string; owner_id?: string; name: string }[] }>('GET', `/guilds/${discordConfig().guildId}/threads/active`);
    return threads.filter((x) => x.parent_id === channelId && x.owner_id === botId && x.name === title).map((x) => ({ channelId: x.id, messageId: x.id, forum: true }));
  }
  const msgs = await discord<{ id: string; author: { id: string }; embeds?: { title?: string }[]; content?: string }[]>('GET', `/channels/${channelId}/messages?limit=50`);
  return msgs.filter((m) => m.author.id === botId && postTitle(m) === title).map((m) => ({ channelId, messageId: m.id }));
}

export async function upsertLiveCard(db: Database, key: string, channel: string, message: Record<string, unknown>, now: Date, extra: Record<string, unknown> = {}): Promise<'updated' | 'posted' | 'off'> {
  const [row] = await db.select().from(jobState).where(eq(jobState.key, key));
  const state = (row?.value ?? null) as CardState | null;
  const save = (v: CardState) => db.insert(jobState).values({ key, value: v }).onConflictDoUpdate({ target: jobState.key, set: { value: v, updatedAt: now } });
  if (state?.messageId) {
    try {
      await edit(state, message);
      await save({ ...state, ...extra });
      return 'updated';
    } catch (e) {
      // Anything but "it is gone" (no access, Discord down, rate limit): keep the card and try next tick — never post a copy.
      if (!gone(e)) throw e;
    }
  }
  const channelId = await layoutChannel(db, channel);
  if (!channelId) return 'off';
  const title = postTitle(message as never);
  const found = await findCards(channelId, title).catch(() => [] as Posted[]);
  if (found.length) {
    const [keep, ...dupes] = found;
    for (const d of dupes) await removePosted(d).catch(() => undefined);
    await edit(keep!, message);
    await save({ ...keep!, ...extra });
    return 'updated';
  }
  const posted = await postIn(channelId, message);
  await pinPosted(posted);
  await save({ ...posted, ...extra });
  return 'posted';
}

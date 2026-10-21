import { and, eq, isNull } from 'drizzle-orm';
import { periodWindow } from '@/lib/game/missions';
import type { Database } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { postCoins } from '@/server/game/coins';
import { notify } from '@/server/game/notify';
import { discord } from './api';
import { BRAND, discordConfig } from './config';
import { layoutChannel } from './layout';
import { announce, enqueue } from './outbox';

/**
 * The photo contest in #снимки: the bot puts a ⭐ under every picture; on
 * Monday the picture of last week with the most ⭐ wins ТрансКоин for its
 * author (linked account, once per week).
 */

export const PHOTO_CONTEST = { prizeCoins: 50, minVotes: 2 } as const;
const STAR = '⭐';
const sofiaHour = (now: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', hour: '2-digit', hourCycle: 'h23' }).format(now));

interface Msg {
  id: string;
  timestamp: string;
  author: { id: string; bot?: boolean };
  attachments?: { url: string; content_type?: string }[];
  reactions?: { emoji: { name: string }; count: number; me?: boolean }[];
}
const picture = (m: Pick<Msg, 'attachments'>) => m.attachments?.find((a) => a.content_type?.startsWith('image/'));

/** The gateway: a ⭐ under every picture posted in #снимки. */
export async function starPhoto(db: Database, m: { id: string; channel_id: string; author: { bot?: boolean }; attachments?: { url: string; content_type?: string }[] }) {
  if (m.author.bot || !picture(m)) return false;
  if (m.channel_id !== (await layoutChannel(db, 'снимки'))) return false;
  await discord('PUT', `/channels/${m.channel_id}/messages/${m.id}/reactions/${encodeURIComponent(STAR)}/@me`);
  return true;
}

/** Worker, Monday from 11:00: last week's best picture (once). */
export async function photoContest(db: Database, now = new Date()) {
  if (!discordConfig().bot || periodWindow('weekly', now).endsAt.getTime() - now.getTime() < 6 * 86_400_000 || sofiaHour(now) < 11) return null;
  const week = periodWindow('weekly', new Date(now.getTime() - 7 * 86_400_000));
  const from = new Date(week.endsAt.getTime() - 7 * 86_400_000);
  const channelId = await layoutChannel(db, 'снимки');
  if (!channelId) return null;
  // Read back through the channel until the start of last week.
  const pictures: { m: Msg; votes: number }[] = [];
  let before: string | undefined;
  for (let page = 0; page < 20; page++) {
    const batch = await discord<Msg[]>('GET', `/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ''}`);
    for (const m of batch) {
      const at = new Date(m.timestamp);
      if (at >= from && at < week.endsAt && !m.author.bot && picture(m)) {
        const r = m.reactions?.find((x) => x.emoji.name === STAR);
        pictures.push({ m, votes: (r?.count ?? 0) - (r?.me ? 1 : 0) });
      }
    }
    if (batch.length < 100 || new Date(batch.at(-1)!.timestamp) < from) break;
    before = batch.at(-1)!.id;
  }
  const best = pictures.sort((a, b) => b.votes - a.votes || a.m.timestamp.localeCompare(b.m.timestamp))[0];
  if (!best || best.votes < PHOTO_CONTEST.minVotes) return null;
  const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.discordId, best.m.author.id), isNull(users.bannedAt)));
  if (u) {
    await db.transaction(async (tx) => {
      if (await postCoins(tx, u.id, { amount: PHOTO_CONTEST.prizeCoins, reason: 'photo_contest', description: `Снимка на седмицата (${week.key})`, idempotencyKey: `photo:${week.key}` })) {
        await notify(tx, u.id, 'success', 'Снимка на седмицата! 📸', `Твоята снимка в Discord събра най-много ⭐ — +${PHOTO_CONTEST.prizeCoins} ТрансКоин.`, '/game/shop');
      }
    });
  }
  const embed = { title: '📸 Снимка на седмицата', color: BRAND, description: `<@${best.m.author.id}> · ${best.votes} ⭐${u ? ` · +${PHOTO_CONTEST.prizeCoins} ТрансКоин` : ' · (свържи акаунта си за наградата)'}`, image: { url: picture(best.m)!.url } };
  await enqueue(db, `photo-week:${week.key}`, `msg:${channelId}`, { content: `<@${best.m.author.id}>`, allowed_mentions: { parse: [], users: [best.m.author.id] }, embeds: [embed] }, now);
  await announce(db, `photo-week-rank:${week.key}`, 'rankings', { ping: false, embeds: [embed] }, now);
  return best.m.id;
}

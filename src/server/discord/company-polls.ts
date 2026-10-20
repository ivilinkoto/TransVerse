import { and, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Database, DbOrTx } from '@/server/db/client';
import { companyPolls, companyPollVotes, organizations } from '@/server/db/schema';
import { discord, DiscordError } from './api';
import { act, answer, type Answer, type Ctx } from './context';
import { discordConfig } from './config';
import { bar, button, rows, STYLE, update, type MessageData } from './ui';

/**
 * Company polls in the company's Discord channel: the same poll as in the
 * game chat, with a button per answer. A vote from Discord is a vote in the
 * game (runAction); the worker keeps the message's numbers up to date and
 * shows the result when the poll closes.
 */

type Poll = typeof companyPolls.$inferSelect;
const at = (d: Date) => `<t:${Math.floor(d.getTime() / 1000)}:R>`;
const NUMBERS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

async function counts(db: DbOrTx, pollId: string, options: number) {
  const rows = await db.select({ option: companyPollVotes.option, n: sql<number>`count(*)::int` }).from(companyPollVotes).where(eq(companyPollVotes.pollId, pollId)).groupBy(companyPollVotes.option);
  const out = Array.from({ length: options }, (_, i) => rows.find((r) => r.option === i)?.n ?? 0);
  return { out, total: out.reduce((a, b) => a + b, 0) };
}

function view(p: Poll, c: { out: number[]; total: number }, closed: boolean): MessageData {
  return {
    embeds: [{
      title: `📊 ${p.question}`,
      color: closed ? 0x9aa3b2 : 0x2f7bff,
      description: p.options.map((o, i) => `${NUMBERS[i] ?? '•'} **${o}**\n${bar(c.total ? c.out[i]! / c.total : 0)} · ${c.out[i]} гл.`).join('\n\n'),
      footer: { text: closed ? `Анкетата приключи · ${c.total} гласа` : `${c.total} гласа · гласуваш и от играта (чатът на компанията)` },
      ...(closed ? {} : { fields: [{ name: 'Край', value: at(p.closesAt), inline: true }] }),
    }],
    components: closed ? [] : rows(...p.options.map((o, i) => button(o, `poll:${p.id}:${i}`, STYLE.secondary, NUMBERS[i]))),
  };
}

/** A vote from Discord. */
export async function votePollFromDiscord(ctx: Ctx, pollId: string, option: number): Promise<Answer> {
  await act(ctx, { type: 'votePoll', pollId, option });
  const [p] = await ctx.db.select().from(companyPolls).where(eq(companyPolls.id, pollId));
  const c = await counts(ctx.db, pollId, p!.options.length);
  await ctx.db.update(companyPolls).set({ discordVotes: c.total }).where(eq(companyPolls.id, pollId));
  return answer(update(view(p!, c, false)));
}

/** Worker: posts new polls to company channels, refreshes the numbers and shows the result. */
export async function syncCompanyPolls(db: Database, now = new Date()) {
  if (!discordConfig().bot) return;
  const fresh = await db
    .select({ p: companyPolls, channelId: organizations.discordChannelId })
    .from(companyPolls)
    .innerJoin(organizations, eq(organizations.id, companyPolls.organizationId))
    .where(and(isNull(companyPolls.discordMessageId), isNull(companyPolls.closedAt), gt(companyPolls.closesAt, now), isNotNull(organizations.discordChannelId)))
    .limit(20);
  for (const { p, channelId } of fresh) {
    const msg = await discord<{ id: string }>('POST', `/channels/${channelId}/messages`, view(p, await counts(db, p.id, p.options.length), false));
    await db.update(companyPolls).set({ discordChannelId: channelId, discordMessageId: msg.id }).where(eq(companyPolls.id, p.id));
  }
  // discordVotes -1: the result is already shown.
  const shown = await db.select().from(companyPolls).where(and(isNotNull(companyPolls.discordMessageId), sql`${companyPolls.discordVotes} >= 0`)).limit(50);
  for (const p of shown) {
    const closed = !!p.closedAt || p.closesAt <= now;
    const c = await counts(db, p.id, p.options.length);
    if (!closed && c.total === p.discordVotes) continue;
    try {
      await discord('PATCH', `/channels/${p.discordChannelId}/messages/${p.discordMessageId}`, view(p, c, closed));
    } catch (error) {
      // The message or the channel was removed: stop updating it.
      if (!(error instanceof DiscordError && error.status === 404)) throw error;
      await db.update(companyPolls).set({ discordVotes: -1 }).where(eq(companyPolls.id, p.id));
      continue;
    }
    await db.update(companyPolls).set({ discordVotes: closed ? -1 : c.total }).where(eq(companyPolls.id, p.id));
  }
}

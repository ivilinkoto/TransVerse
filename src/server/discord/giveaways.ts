import { randomInt } from 'node:crypto';
import { and, count, eq, inArray, isNull, lte } from 'drizzle-orm';
import { int } from '@/lib/format';
import type { Database } from '@/server/db/client';
import { discordGiveawayEntries, discordGiveaways, users } from '@/server/db/schema';
import { postCoins } from '@/server/game/coins';
import { notify } from '@/server/game/notify';
import { discord } from './api';
import { answer, editOriginal, hasPerm, linked, opt, PERM, stop, type Answer, type Ctx } from './context';
import { discordConfig } from './config';
import { pingRoleFor } from './guild';
import { layoutChannel } from './layout';
import { enqueue } from './outbox';
import { button, deferred, rows, say, STYLE, update, type MessageData } from './ui';
import { t } from '@/i18n/t';

/**
 * ТрансКоин giveaways (#раздавания). The team starts one with /раздаване;
 * linked players press "Участвам"; when it ends the worker draws the
 * winners once and pays them (postCoins, one key per winner).
 */

type Giveaway = typeof discordGiveaways.$inferSelect;
const at = (d: Date) => `<t:${Math.floor(d.getTime() / 1000)}:R>`;

function view(g: Giveaway, entries: number, winners?: { discordId: string | null; username: string }[]): MessageData {
  const done = !!winners;
  return {
    embeds: [{
      title: `🎁 ${g.title}`,
      color: done ? 0x9aa3b2 : 0xf6c343,
      description: done
        ? t('**Награда:** {0} ТрансКоин{1}\n**Участваха:** {2}\n\n🏆 {3}', int(g.prizeCoins), g.winners > 1 ? ` × ${g.winners}` : '', int(entries), winners!.length ? winners!.map((w) => (w.discordId ? `<@${w.discordId}>` : w.username)).join(', ') : t('Нямаше участници.'))
        : t('**Награда:** {0} ТрансКоин{1}\n**Край:** {2}\n**Участват:** {3}\n\nНатисни **Участвам** — нужен е свързан акаунт в играта.', int(g.prizeCoins), g.winners > 1 ? t(' за {0} победители', g.winners) : '', at(g.endsAt), int(entries)),
      footer: { text: done ? t('Раздаването приключи · ТрансКоин са в акаунтите') : t('TransVerse · ТрансКоин влизат в акаунта автоматично') },
    }],
    components: done ? [] : rows(button(t('Участвам'), `give:join:${g.id}`, STYLE.success, '🎉')),
  };
}

/** /раздаване (team): starts a giveaway in #раздавания. */
export async function startGiveaway(ctx: Ctx): Promise<Answer> {
  if (!hasPerm(ctx, PERM.manageGuild)) stop(t('Само екипът прави раздавания.'));
  const prize = Math.round(Number(opt(ctx.i, t('награда')) ?? 0));
  const hours = Math.round(Number(opt(ctx.i, t('часове')) ?? 24));
  const winners = Math.round(Number(opt(ctx.i, t('победители')) ?? 1));
  const title = (opt(ctx.i, t('заглавие')) ?? t('Раздаване')).trim().slice(0, 100) || t('Раздаване');
  if (!(prize >= 1 && prize <= 100_000)) stop(t('Наградата е между 1 и 100 000 ТрансКоин.'));
  if (!(hours >= 1 && hours <= 24 * 14)) stop(t('Продължителността е от 1 час до 14 дни.'));
  if (!(winners >= 1 && winners <= 20)) stop(t('Победителите са от 1 до 20.'));
  const channelId = await layoutChannel(ctx.db, t('раздавания'));
  if (!channelId) stop(t('Няма канал #раздавания — подреди сървъра от админ панела.'));
  const [g] = await ctx.db.insert(discordGiveaways).values({ title, prizeCoins: prize, winners, endsAt: new Date(ctx.now.getTime() + hours * 3_600_000), channelId, createdByDiscordId: ctx.discordId, createdByUserId: ctx.me?.id ?? null }).returning();
  return answer(deferred(), async () => {
    const role = await pingRoleFor('giveaways');
    const msg = await discord<{ id: string }>('POST', `/channels/${channelId}/messages`, { ...view(g!, 0), ...(role ? { content: `<@&${role}>`, allowed_mentions: { parse: [], roles: [role] } } : {}) });
    await ctx.db.update(discordGiveaways).set({ messageId: msg.id }).where(eq(discordGiveaways.id, g!.id));
    await editOriginal(ctx.i, { content: t('✅ Раздаването започна в <#{0}>.', channelId) });
  });
}

const entryCount = async (db: Database, id: string) => (await db.select({ n: count() }).from(discordGiveawayEntries).where(eq(discordGiveawayEntries.giveawayId, id)))[0]?.n ?? 0;

/** "Участвам". */
export async function joinGiveaway(ctx: Ctx, id: string): Promise<Answer> {
  const me = linked(ctx);
  const [g] = await ctx.db.select().from(discordGiveaways).where(eq(discordGiveaways.id, id));
  if (!g) stop(t('Няма такова раздаване.'));
  if (g!.drawnAt || g!.endsAt <= ctx.now) stop(t('Раздаването приключи.'));
  const added = await ctx.db.insert(discordGiveawayEntries).values({ giveawayId: id, userId: me.id, createdAt: ctx.now }).onConflictDoNothing().returning();
  if (!added.length) return answer(say(t('Вече участваш — успех! 🍀')));
  return answer(update(view(g!, await entryCount(ctx.db, id))));
}

/** Worker: giveaways that ended get their winners (once) and the prize. */
export async function drawGiveaways(db: Database, now = new Date()) {
  if (!discordConfig().bot) return 0;
  const due = await db.select({ id: discordGiveaways.id }).from(discordGiveaways).where(and(isNull(discordGiveaways.drawnAt), lte(discordGiveaways.endsAt, now))).limit(10);
  for (const { id } of due) {
    const result = await db.transaction(async (tx) => {
      // Only one draw, even with two workers.
      const [g] = await tx.update(discordGiveaways).set({ drawnAt: now }).where(and(eq(discordGiveaways.id, id), isNull(discordGiveaways.drawnAt))).returning();
      if (!g) return null;
      const entries = await tx.select({ userId: discordGiveawayEntries.userId }).from(discordGiveawayEntries).innerJoin(users, eq(users.id, discordGiveawayEntries.userId)).where(and(eq(discordGiveawayEntries.giveawayId, id), isNull(users.bannedAt)));
      const pool = entries.map((e) => e.userId);
      const picked: string[] = [];
      while (pool.length && picked.length < g.winners) picked.push(pool.splice(randomInt(pool.length), 1)[0]!);
      for (const userId of picked) {
        await postCoins(tx, userId, { amount: g.prizeCoins, reason: 'giveaway', description: t('Раздаване: {0}', g.title), idempotencyKey: `giveaway:${g.id}:${userId}` });
        await notify(tx, userId, 'success', () => t('Спечели раздаване! 🎉'), () => t('{0} ТрансКоин от „{1}“ в Discord.', g.prizeCoins, g.title), '/game/shop');
      }
      await tx.update(discordGiveaways).set({ winnerIds: picked }).where(eq(discordGiveaways.id, id));
      return { g: { ...g, winnerIds: picked }, entries: entries.length };
    });
    if (!result) continue;
    const { g } = result;
    const winners = g.winnerIds.length ? await db.select({ discordId: users.discordId, username: users.username }).from(users).where(inArray(users.id, g.winnerIds)) : [];
    if (g.channelId && g.messageId) await discord('PATCH', `/channels/${g.channelId}/messages/${g.messageId}`, view(g, result.entries, winners)).catch(() => undefined);
    const mentions = winners.map((w) => w.discordId).filter((x): x is string => !!x);
    if (g.channelId) {
      await enqueue(db, `giveaway-won:${g.id}`, `msg:${g.channelId}`, {
        content: winners.length ? t('🎉 Честито, {0}! Спечелихте по **{1} ТрансКоин** от „{2}“ — вече са в акаунта ви.', winners.map((w) => (w.discordId ? `<@${w.discordId}>` : w.username)).join(', '), int(g.prizeCoins), g.title) : t('Раздаването „{0}“ приключи без участници.', g.title),
        allowed_mentions: { parse: [], users: mentions },
      }, now);
    }
  }
  return due.length;
}

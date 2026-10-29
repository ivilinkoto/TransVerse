import { randomInt } from 'node:crypto';
import { and, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { int } from '@/lib/format';
import { featureLive } from '@/lib/game/features';
import { DISCORD_FRAMES } from '@/lib/game/together';
import { testsUnreleased } from '@/server/auth/roles';
import type { Database } from '@/server/db/client';
import { discordMembers, discordVoice, userBadges, users } from '@/server/db/schema';
import { postCoins } from '@/server/game/coins';
import { notify } from '@/server/game/notify';
import { answer, opt, type Answer, type Ctx } from './context';
import { appUrl, BRAND, discordConfig } from './config';
import { layoutState } from './layout';
import { enqueue } from './outbox';
import { bar, reply } from './ui';
import { t } from '@/i18n/t';

/**
 * Levels in the Discord server: experience for writing (15–25 at most once a
 * minute) and for talking in voice (10 a minute with someone else, not in
 * AFK). A level-up is congratulated in #бот-команди; every tenth level a
 * linked player gets ТрансКоин in the game (once per level).
 */

/** Experience from level n to n + 1. */
export const xpToNext = (level: number) => 5 * level * level + 50 * level + 100;
export function levelOf(xp: number) {
  let level = 0;
  let left = xp;
  while (left >= xpToNext(level)) left -= xpToNext(level++);
  return { level, into: left, next: xpToNext(level) };
}
/** ТрансКоин for reaching a level (every tenth). */
export const levelReward = (level: number) => (level > 0 && level % 10 === 0 ? level : 0);

const MESSAGE_COOLDOWN_MS = 60_000;
const VOICE_XP = 10;

interface Author {
  id: string;
  username?: string;
  global_name?: string | null;
  avatar?: string | null;
  bot?: boolean;
}

async function addXp(db: Database, who: Author, xp: number, extra: { messages?: number; voiceMinutes?: number }, now: Date) {
  const name = who.global_name || who.username || '';
  const [row] = await db
    .insert(discordMembers)
    .values({ discordUserId: who.id, name, avatar: who.avatar ?? null, xp, level: levelOf(xp).level, messages: extra.messages ?? 0, voiceMinutes: extra.voiceMinutes ?? 0, lastXpAt: extra.messages ? now : null, updatedAt: now })
    .onConflictDoUpdate({
      target: discordMembers.discordUserId,
      set: {
        xp: sql`${discordMembers.xp} + ${xp}`,
        messages: sql`${discordMembers.messages} + ${extra.messages ?? 0}`,
        voiceMinutes: sql`${discordMembers.voiceMinutes} + ${extra.voiceMinutes ?? 0}`,
        ...(name ? { name } : {}),
        ...(who.avatar !== undefined ? { avatar: who.avatar } : {}),
        ...(extra.messages ? { lastXpAt: now } : {}),
        updatedAt: now,
      },
    })
    .returning();
  const level = levelOf(row!.xp).level;
  if (level <= row!.level) return;
  await db.update(discordMembers).set({ level }).where(eq(discordMembers.discordUserId, who.id));
  await levelUp(db, who.id, level, now);
}

async function levelUp(db: Database, discordId: string, level: number, now: Date) {
  const coins = levelReward(level);
  const [u] = await db.select({ id: users.id, role: users.role, uiPrefs: users.uiPrefs }).from(users).where(and(eq(users.discordId, discordId), isNull(users.bannedAt)));
  // Frames around the profile picture in the game for levels 10 and 25 (v1.3).
  const frame = DISCORD_FRAMES.find((f) => level >= f.level);
  if (u && frame && featureLive('discord_bot', now, testsUnreleased(u))) {
    await db.insert(userBadges).values(DISCORD_FRAMES.filter((f) => level >= f.level).map((f) => ({ userId: u.id, badge: f.badge, awardedAt: now }))).onConflictDoNothing();
  }
  if (u && coins) {
    await db.transaction(async (tx) => {
      if (await postCoins(tx, u.id, { amount: coins, reason: 'discord_level', description: t('Ниво {0} в Discord', level), idempotencyKey: `discord-level:${discordId}:${level}` })) {
        await notify(tx, u.id, 'success', () => t('Ниво {0} в Discord! 🎉', level), () => t('Получаваш {0} ТрансКоин.', coins), '/game/shop');
      }
    });
  }
  await enqueue(db, `level-up:${discordId}:${level}`, 'channel:botCommands', {
    ping: false,
    content: t('🎉 <@{0}> стигна **ниво {1}**!{2}', discordId, level, coins ? (u ? t(' +{0} ТрансКоин в играта.', coins) : t(' Свържи акаунта си, за да получаваш ТрансКоин на всяко десето ниво.')) : ''),
    allowed_mentions: { parse: [], users: [discordId] },
  }, now);
}

/** A message in the server (not the bot's own channels and not the logs). */
export async function messageXp(db: Database, m: { channel_id: string; author: Author; webhook_id?: string }, now = new Date()) {
  if (m.author.bot || m.webhook_id) return false;
  const [me] = await db.select({ last: discordMembers.lastXpAt }).from(discordMembers).where(eq(discordMembers.discordUserId, m.author.id));
  if (me?.last && now.getTime() - me.last.getTime() < MESSAGE_COOLDOWN_MS) {
    await db.update(discordMembers).set({ messages: sql`${discordMembers.messages} + 1` }).where(eq(discordMembers.discordUserId, m.author.id));
    return false;
  }
  await addXp(db, m.author, 15 + randomInt(11), { messages: 1 }, now);
  return true;
}

/** Worker, every minute: experience for everyone talking with someone else (not in AFK or "Създай стая"). */
export async function voiceXp(db: Database, now = new Date()) {
  if (!discordConfig().bot) return 0;
  const state = await layoutState(db);
  const skip = [state.channels['afk'], state.channels['създай-стая']].filter((x): x is string => !!x);
  const rows = await db.select().from(discordVoice);
  const per = new Map<string, number>();
  for (const r of rows) per.set(r.channelId, (per.get(r.channelId) ?? 0) + 1);
  let n = 0;
  for (const r of rows) {
    if (skip.includes(r.channelId) || (per.get(r.channelId) ?? 0) < 2) continue;
    await addXp(db, { id: r.discordUserId }, VOICE_XP, { voiceMinutes: 1 }, now);
    n++;
  }
  return n;
}

/** The gateway: who is in which voice channel. */
export async function setVoice(db: Database, discordId: string, channelId: string | null, now = new Date()) {
  if (!channelId) {
    await db.delete(discordVoice).where(eq(discordVoice.discordUserId, discordId));
    return;
  }
  await db.insert(discordVoice).values({ discordUserId: discordId, channelId, joinedAt: now }).onConflictDoUpdate({ target: discordVoice.discordUserId, set: { channelId, joinedAt: now } });
}
/** After (re)connecting: the voice channels as the server has them now. */
export async function resetVoice(db: Database, states: { user_id: string; channel_id: string | null }[], now = new Date()) {
  await db.transaction(async (tx) => {
    await tx.delete(discordVoice);
    const rows = states.filter((s) => s.channel_id).map((s) => ({ discordUserId: s.user_id, channelId: s.channel_id!, joinedAt: now }));
    if (rows.length) await tx.insert(discordVoice).values(rows).onConflictDoNothing();
  });
}

async function rankOf(db: Database, discordId: string) {
  const [me] = await db.select().from(discordMembers).where(eq(discordMembers.discordUserId, discordId));
  if (!me) return null;
  const [{ n = 0 } = {}] = await db.select({ n: sql<number>`count(*)::int` }).from(discordMembers).where(or(gt(discordMembers.xp, me.xp), and(eq(discordMembers.xp, me.xp), lt(discordMembers.discordUserId, me.discordUserId))));
  return { ...me, place: n + 1 };
}

/** /ранг [потребител]: level, experience and place, with a picture card. */
export async function rankView(ctx: Ctx): Promise<Answer> {
  const id = opt(ctx.i, 'потребител') ?? ctx.discordId;
  const r = await rankOf(ctx.db, id);
  if (!r) return answer(reply({ content: id === ctx.discordId ? t('Още нямаш опит — пиши в сървъра или влез в гласов канал.') : t('Този член още няма опит.') }, true));
  const l = levelOf(r.xp);
  return answer(reply({
    embeds: [{
      title: t('Ниво {0} · {1}', l.level, r.name || t('член')),
      color: BRAND,
      description: t('{0}\n{1} / {2} опит до ниво {3}', bar(l.into / l.next), int(l.into), int(l.next), l.level + 1),
      fields: [
        { name: t('Място'), value: `#${r.place}`, inline: true },
        { name: t('Съобщения'), value: int(r.messages), inline: true },
        { name: t('В гласов канал'), value: t('{0} ч {1} мин', Math.floor(r.voiceMinutes / 60), r.voiceMinutes % 60), inline: true },
      ],
      image: { url: `${appUrl()}/api/discord/card/rank/${id}?v=${Math.floor(Date.now() / 600_000)}` },
      footer: { text: t('На всяко десето ниво — ТрансКоин в играта (свързан акаунт)') },
    }],
  }));
}

/** /топ: the ten members with the most experience. */
export async function topView(ctx: Ctx): Promise<Answer> {
  const rows = await ctx.db.select().from(discordMembers).orderBy(desc(discordMembers.xp)).limit(10);
  const medal = (i: number) => ['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`;
  return answer(reply({
    embeds: [{
      title: t('🏆 Най-активните в сървъра'),
      color: BRAND,
      description: rows.map((r, i) => t('{0} <@{1}> · ниво **{2}** · {3} опит', medal(i), r.discordUserId, levelOf(r.xp).level, int(r.xp))).join('\n') || t('Още никой няма опит.'),
    }],
  }));
}

export { rankOf };

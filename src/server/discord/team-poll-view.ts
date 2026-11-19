/**
 * How a team poll looks in Discord (#анкети), and posting or refreshing its message. Kept apart
 * from the commands so the game's actions can refresh a message without importing them.
 */
import type { DbOrTx } from '@/server/db/client';
import { isOpen, tally, type TeamPoll } from '@/server/game/team-polls';
import { t } from '@/i18n/t';
import { discord, noPings } from './api';
import { BRAND, discordConfig } from './config';
import { postIn } from './guild';
import { layoutChannel } from './layout';
import { button, rows, STYLE } from './ui';

export function pollView(id: string, p: TeamPoll, now: Date) {
  const { all: counts, total } = tally(p);
  const open = isOpen(p, now);
  const lines = p.options.map((o, i) => {
    const share = total ? counts[i]! / total : 0;
    return `**${o}**\n${'█'.repeat(Math.round(share * 12)).padEnd(12, '░')} ${Math.round(share * 100)}% · ${counts[i]}`;
  });
  return {
    ...noPings,
    embeds: [{
      title: `📊 ${p.question}`,
      description: `${lines.join('\n\n')}\n\n${open ? t('Гласувай с бутоните (може да смениш гласа) или в играта. Край <t:{0}:R>.', Math.floor(p.endsAt / 1000)) : t('Анкетата приключи · {0} гласа.', total)}`,
      color: open ? BRAND : 0x9aa3b2,
    }],
    components: open ? rows(...p.options.map((o, i) => button(o.slice(0, 80), `tpoll:${id}:${i}`, STYLE.secondary))) : [],
  };
}

/** Posts a new poll in #анкети when the bot runs and the channel is there; returns where (or nulls). */
export async function postTeamPoll(db: DbOrTx, id: string, poll: TeamPoll, now = new Date()): Promise<{ channelId: string | null; messageId: string | null }> {
  if (!discordConfig().bot) return { channelId: null, messageId: null };
  const channelId = await layoutChannel(db, 'анкети');
  if (!channelId) return { channelId: null, messageId: null };
  // In a forum channel the poll is a post of its own.
  const posted = await postIn(channelId, pollView(id, poll, now));
  return { channelId: posted.channelId, messageId: posted.messageId };
}

/** The poll's message in Discord shows the new numbers (best effort: the vote is saved either way). */
export async function refreshTeamPollMessage(id: string, poll: TeamPoll, now = new Date()) {
  if (!discordConfig().bot || !poll.channelId || !poll.messageId) return;
  await discord('PATCH', `/channels/${poll.channelId}/messages/${poll.messageId}`, pollView(id, poll, now)).catch(() => undefined);
}


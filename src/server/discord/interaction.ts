import { eq } from 'drizzle-orm';
import { withLocale } from '@/i18n/als';
import { isLocale, pickLocale } from '@/i18n/config';
import { users } from '@/server/db/schema';
import type { Database } from '@/server/db/client';
import { runCommand } from './commands';
import { votePollFromDiscord } from './company-polls';
import { answer, makeCtx, Stop, type Answer, type Ctx, type Interaction } from './context';
import { joinGiveaway, startGiveaway } from './giveaways';
import { ban, history, timeout, unban, warn } from './moderation';
import { togglePing } from './panels';
import { battleView, courseGo, courseStart, dailyClaim, dailyView, eventView, truckLoads } from './play';
import { closeTicket, createTicketFromForm, openTicket, ticketForm } from './tickets';
import { appealDecide, appealForm, appealSend, staffStats } from './appeals';
import { verifyAnswer, verifyStart } from './check';
import { eventStart, helpView } from './help';
import { rankView, topView } from './levels';
import { auctionForm, auctionOffer, auctionView, cheerBase, inviteAnswer, inviteMember, marketBuyers, marketSell, marketView, missionClaim, missionsView } from './market';
import { quizAnswer } from './quiz';
import { convoyCommand, convoyGo, convoyJoin, duelAnswer, duelCommand, financeView, liveryVote, mapCommand, passClaim, passCommand, roadCall, roadHelp, roadPay, takeGo, takeStart, usedBuy } from './together';
import { reply, say } from './ui';
import { ideaVote, newsCommand, pollCommand, pollVote } from './channels-1132';
import { translateMessage } from './translate';
import { gameMenu, menuButton, planNext, planPick, startView } from './menu';
import { t } from '@/i18n/t';

export type { Interaction };

/** Slash commands with their own handlers (the read-only ones are in commands.ts). */
const COMMAND_HANDLERS: Record<string, (ctx: Ctx) => Answer | Promise<Answer>> = {
  курс: courseStart,
  дневна: dailyView,
  ивент: eventView,
  битка: battleView,
  тикет: openTicket,
  предупреждение: warn,
  заглуши: timeout,
  бан: ban,
  разбани: unban,
  наказания: history,
  раздаване: startGiveaway,
  пазар: marketView,
  търг: auctionView,
  мисии: (ctx) => missionsView(ctx),
  покани: inviteMember,
  ранг: rankView,
  топ: topView,
  'екип-статистика': staffStats,
  'ивент-старт': eventStart,
  помощ: helpView,
  карта: mapCommand,
  конвой: convoyCommand,
  финанси: financeView,
  дуел: duelCommand,
  пропуск: passCommand,
  новина: newsCommand,
  анкета: pollCommand,
  Преведи: translateMessage,
  игра: gameMenu,
  старт: startView,
};

/** Buttons and select menus, by the start of their custom_id. */
async function component(ctx: Ctx, id: string, values: string[]): Promise<Answer> {
  const [kind, a = '', b = ''] = id.split(':');
  switch (kind) {
    case 'ping':
      return togglePing(ctx, a);
    case 'ticket':
      if (a === 'open') return openTicket(ctx);
      if (a === 'cat') return ticketForm(ctx, values[0] ?? '');
      if (a === 'close') return closeTicket(ctx);
      break;
    case 'course':
      // From /курс (a select) or from "Нов курс" under a delivery notification (a button with the truck).
      if (a === 'truck') return answer(await truckLoads(ctx, b || values[0] || '', b ? 'reply' : 'update'));
      if (a === 'pick') return courseGo(ctx, b, values[0] ?? '');
      break;
    case 'daily':
      return dailyClaim(ctx);
    // 1.1.4.1: /игра and „Планирай следващ“.
    case 'menu':
      if (a === 'course') return courseStart(ctx);
      if (a === 'missions') return missionsView(ctx);
      return (await menuButton(ctx, a)) ?? answer(say(t('Непозната команда.')));
    case 'plan':
      if (a === 'truck') return planNext(ctx, b);
      if (a === 'pick') return planPick(ctx, b, values[0] ?? '');
      break;
    case 'give':
      return joinGiveaway(ctx, b);
    case 'poll':
      return votePollFromDiscord(ctx, a, Number(b));
    case 'market':
      if (a === 'lot') return marketBuyers(ctx, values[0] ?? '');
      if (a === 'sell') return marketSell(ctx, b, Number(values[0]));
      break;
    case 'auction':
      return auctionForm(b);
    case 'mission':
      return missionClaim(ctx, b, id.split(':')[3] ?? '');
    case 'cheer':
      return cheerBase(ctx, a);
    case 'invite':
      return inviteAnswer(ctx, b, a === 'yes');
    case 'appeal':
      if (a === 'open') return appealForm(ctx, Number(b));
      return appealDecide(ctx, Number(b), a === 'yes');
    case 'verify':
      return verifyStart(ctx);
    case 'quiz':
      return quizAnswer(ctx, a, Number(b));
    case 'take':
      // "take:<load>" (a button) or "take:go:<load>" (the truck from the menu).
      if (a === 'go') return takeGo(ctx, b, values[0] ?? '');
      return takeStart(ctx, a);
    case 'convoy':
      if (a === 'join') return convoyJoin(ctx, b);
      if (a === 'go') return convoyGo(ctx, values[0] ?? '');
      break;
    case 'used':
      return usedBuy(ctx, b);
    case 'duel':
      return duelAnswer(ctx, b, a === 'yes');
    case 'pass':
      return passClaim(ctx);
    case 'road':
      if (a === 'pay') return roadPay(ctx, b);
      if (a === 'call') return roadCall(ctx, b);
      if (a === 'help') return roadHelp(ctx, b);
      break;
    case 'livery':
      return liveryVote(ctx, b);
    case 'idea':
      if (a === 'vote') return ideaVote(ctx, b);
      break;
    case 'tpoll':
      return pollVote(ctx, a, Number(b));
  }
  return answer(say(t('Този бутон вече не работи.')));
}

/**
 * The answer to an interaction (the same for the HTTP endpoint and the
 * gateway): slash commands, buttons, select menus and forms.
 */
export async function answerInteraction(db: Database, i: Interaction): Promise<Answer> {
  // v2.0: a linked player gets the language of the game; anyone else the language of their Discord.
  const discordId = i.member?.user?.id ?? i.user?.id;
  const [linked] = discordId ? await db.select({ locale: users.locale }).from(users).where(eq(users.discordId, discordId)) : [];
  const locale = isLocale(linked?.locale) ? linked.locale : pickLocale(i.locale);
  const a = await withLocale(locale, () => answerIn(db, i));
  return a.later ? { ...a, later: () => withLocale(locale, a.later!) } : a;
}

async function answerIn(db: Database, i: Interaction): Promise<Answer> {
  // PING when the endpoint is saved in the Developer Portal.
  if (i.type === 1) return answer({ type: 1 });
  const ctx = await makeCtx(db, i);
  try {
    if (i.type === 2 && i.data?.name) {
      const own = COMMAND_HANDLERS[i.data.name];
      if (own) return await own(ctx);
      const options = Object.fromEntries((i.data.options ?? []).map((o) => [o.name, String(o.value)]));
      const r = await runCommand(db, { name: i.data.name, options, discordUserId: ctx.discordId });
      return answer(reply({ content: r.content, embeds: r.embeds, components: r.components }, !!r.ephemeral));
    }
    if (i.type === 3 && i.data?.custom_id) return await component(ctx, i.data.custom_id, i.data.values ?? []);
    if (i.type === 5 && i.data?.custom_id) {
      const [kind, a = '', b = ''] = i.data.custom_id.split(':');
      if (kind === 'ticket' && a === 'new') return await createTicketFromForm(ctx, b);
      if (kind === 'auction' && a === 'offer') return await auctionOffer(ctx, b);
      if (kind === 'appeal' && a === 'send') return await appealSend(ctx, Number(b));
      if (kind === 'verify' && a === 'sum') return await verifyAnswer(ctx, b);
    }
    return answer(say(t('Непозната команда.')));
  } catch (error) {
    if (error instanceof Stop) return error.answer;
    console.error('[discord] interaction failed', i.data?.name ?? i.data?.custom_id, error);
    return answer(say(t('Нещо се обърка — опитай пак след малко.')));
  }
}

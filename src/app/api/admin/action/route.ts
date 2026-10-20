import { z } from 'zod';
import { adminResetLink, adminVerifyEmail, sendTestMail, adjustBalance, adjustCoins, adminReplenishMarket, adminResetCompanyBranding, setVip, requireStaff, setBan, setUserRole } from '@/server/admin';
import { getDb } from '@/server/db/client';
import { cancelEvent, createEvent, eventSchema } from '@/server/game/events';
import { diagnosePaypal, refundPaypalPayment } from '@/server/payments';
import { siteUrl } from '@/server/payments/common';
import { recordAudit, requireAdminRole } from '@/server/admin';
import { parseSeasonMode } from '@/lib/game/seasonal';
import { setSeasonMode } from '@/server/seasonal';
import { assignTicket, replySchema, replyToTicket, setTicketStatus } from '@/server/game/support';
import { handler } from '@/server/http';
import { diagnoseDiscord, repairDiscord } from '@/server/discord/diagnose';
import { resolveReport, unmute } from '@/server/game/moderation';
import { createUrgentContract, urgentSchema } from '@/server/urgent';

const id = z.string().uuid('Невалиден идентификатор.');

/** Administrative commands. Every handler re-checks the actor's role on the server. */
const AdminAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('setRole'), userId: id, role: z.enum(['player', 'support', 'admin']) }),
  z.object({ type: z.literal('ban'), userId: id, reason: z.string().trim().max(300).default('') }),
  z.object({ type: z.literal('unban'), userId: id }),
  z.object({ type: z.literal('adjustBalance'), userId: id, amountEur: z.coerce.number().refine((n) => Number.isFinite(n) && n !== 0, 'Невалидна сума.'), reason: z.string().trim().max(300) }),
  z.object({ type: z.literal('replenishMarket') }),
  z.object({ type: z.literal('ticketReply'), ticketId: id, body: replySchema }),
  z.object({ type: z.literal('ticketStatus'), ticketId: id, status: z.enum(['open', 'answered', 'closed']) }),
  z.object({ type: z.literal('ticketAssign'), ticketId: id }),
  z.object({ type: z.literal('createUrgentContract'), contract: urgentSchema }),
  z.object({ type: z.literal('adjustCoins'), userId: id, amount: z.coerce.number().int('Цяло число.'), reason: z.string().trim().max(300) }),
  z.object({ type: z.literal('setVip'), userId: id, days: z.coerce.number().int('Срокът е в цели дни.').min(0).max(3650) }),
  z.object({ type: z.literal('resetCompanyBranding'), companyId: id, reason: z.string().trim().max(300) }),
  z.object({ type: z.literal('createEvent'), event: eventSchema }),
  z.object({ type: z.literal('cancelEvent'), eventId: id }),
  z.object({ type: z.literal('refundPayment'), paymentId: id }),
  z.object({ type: z.literal('checkPaypal') }),
  z.object({ type: z.literal('checkDiscord') }),
  z.object({ type: z.literal('repairDiscord') }),
  z.object({ type: z.literal('resetLink'), userId: id }),
  z.object({ type: z.literal('resolveReport'), reportId: id, action: z.enum(['dismiss', 'warn', 'delete_message', 'mute_h24', 'mute_d7']) }),
  z.object({ type: z.literal('unmute'), userId: id }),
  z.object({ type: z.literal('testMail'), to: z.string().trim().toLowerCase().email('Невалиден имейл.') }),
  z.object({ type: z.literal('verifyUserEmail'), userId: id }),
  z.object({ type: z.literal('seasonMode'), value: z.string().trim().max(40) }),
]);

export const POST = handler({ schema: AdminAction, perMinute: 60 }, async ({ user, input, request }) => {
  requireStaff(user);
  const db = getDb();
  switch (input.type) {
    case 'resolveReport':
      await resolveReport(db, user, input.reportId, input.action);
      return { ok: true };
    case 'testMail':
      return { ok: true, sent: await sendTestMail(user, input.to, siteUrl(request.headers.get('origin'))) };
    case 'seasonMode': {
      requireAdminRole(user);
      const [mode, season] = input.value.split(':');
      const parsed = parseSeasonMode({ mode, season });
      await setSeasonMode(db, parsed);
      await recordAudit(db, user.id, 'season_mode', null, { value: input.value });
      return { ok: true };
    }
    case 'verifyUserEmail':
      await adminVerifyEmail(db, user, input.userId);
      return { ok: true };
    case 'unmute':
      await unmute(db, user, input.userId);
      return { ok: true };
    case 'setRole':
      await setUserRole(db, user, input.userId, input.role);
      return { ok: true };
    case 'ban':
      await setBan(db, user, input.userId, true, input.reason);
      return { ok: true };
    case 'unban':
      await setBan(db, user, input.userId, false, '');
      return { ok: true };
    case 'adjustBalance':
      await adjustBalance(db, user, input.userId, Math.round(input.amountEur * 100), input.reason);
      return { ok: true };
    case 'replenishMarket':
      return { ok: true, created: await adminReplenishMarket(db, user) };
    case 'ticketReply':
      await replyToTicket(db, user, input.ticketId, input.body);
      return { ok: true };
    case 'ticketStatus':
      await setTicketStatus(db, user, input.ticketId, input.status);
      return { ok: true };
    case 'ticketAssign':
      await assignTicket(db, user, input.ticketId);
      return { ok: true };
    case 'createUrgentContract':
      return { ok: true, id: (await createUrgentContract(db, user, input.contract)).id };
    case 'adjustCoins':
      await adjustCoins(db, user, input.userId, input.amount, input.reason);
      return { ok: true };
    case 'setVip':
      return { ok: true, until: await setVip(db, user, input.userId, input.days) };
    case 'resetCompanyBranding':
      await adminResetCompanyBranding(db, user, input.companyId, input.reason);
      return { ok: true };
    case 'createEvent':
      return { ok: true, id: (await createEvent(db, user, input.event)).id };
    case 'cancelEvent':
      await cancelEvent(db, user, input.eventId);
      return { ok: true };
    case 'refundPayment':
      await refundPaypalPayment(db, user, input.paymentId);
      return { ok: true };
    case 'checkPaypal':
      requireAdminRole(user);
      return diagnosePaypal();
    case 'checkDiscord':
      requireAdminRole(user);
      return { ok: true, checks: await diagnoseDiscord(db) };
    case 'repairDiscord': {
      requireAdminRole(user);
      const done = await repairDiscord(db);
      await recordAudit(db, user.id, 'discord_repair', null, done);
      return { ok: true, ...done };
    }
    case 'resetLink':
      return { ok: true, url: await adminResetLink(db, user, input.userId, siteUrl(request.headers.get('origin'))) };
  }
});

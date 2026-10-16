import { z } from 'zod';
import { adjustBalance, adminReplenishMarket, requireStaff, setBan, setUserRole } from '@/server/admin';
import { getDb } from '@/server/db/client';
import { assignTicket, replySchema, replyToTicket, setTicketStatus } from '@/server/game/support';
import { handler } from '@/server/http';

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
]);

export const POST = handler({ schema: AdminAction, perMinute: 60 }, async ({ user, input }) => {
  requireStaff(user);
  const db = getDb();
  switch (input.type) {
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
  }
});

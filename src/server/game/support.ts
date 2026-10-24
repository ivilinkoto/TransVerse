import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isStaff } from '@/server/auth/roles';
import type { Database, DbOrTx } from '@/server/db/client';
import { supportMessages, supportTickets, users } from '@/server/db/schema';
import { fail } from './errors';
import { notify } from './notify';
import { t } from '@/i18n/t';

export const TICKET_CATEGORIES = { account: 'Профил и вход', bug: 'Техническа грешка', gameplay: 'Въпрос за играта', payment: 'Плащания', other: 'Друго' } as const;
export const TICKET_STATUS = { open: 'Отворен', answered: 'Отговорен', closed: 'Затворен' } as const;

export const ticketSchema = z.object({
  subject: z.string().trim().min(4, 'Темата трябва да е поне 4 символа.').max(120, 'До 120 символа.'),
  category: z.enum(Object.keys(TICKET_CATEGORIES) as [keyof typeof TICKET_CATEGORIES, ...(keyof typeof TICKET_CATEGORIES)[]]),
  body: z.string().trim().min(10, 'Опишете проблема с поне 10 символа.').max(4000, 'До 4000 символа.'),
});
export const replySchema = z.string().trim().min(1, 'Съобщението е празно.').max(4000, 'До 4000 символа.');

interface Actor {
  id: string;
  role: string;
  username: string;
}

async function staffIds(db: DbOrTx) {
  const rows = await db.select({ id: users.id }).from(users).where(inArray(users.role, ['support', 'admin', 'founder']));
  return rows.map((r) => r.id);
}

export async function createTicket(db: Database, actor: Actor, input: z.infer<typeof ticketSchema>) {
  return db.transaction(async (tx) => {
    const [{ open = 0 } = {}] = await tx.select({ open: sql<number>`count(*)::int` }).from(supportTickets).where(and(eq(supportTickets.userId, actor.id), inArray(supportTickets.status, ['open', 'answered'])));
    if (open >= 5) fail('too_many_tickets', t('Имате 5 отворени запитвания. Изчакайте отговор или затворете някое.'));
    const [ticket] = await tx.insert(supportTickets).values({ userId: actor.id, subject: input.subject, category: input.category }).returning();
    await tx.insert(supportMessages).values({ ticketId: ticket!.id, authorId: actor.id, staff: false, body: input.body });
    for (const id of await staffIds(tx)) await notify(tx, id, 'info', () => t('Ново запитване: {0}', input.subject), () => t('От {0} · {1}', actor.username, TICKET_CATEGORIES[input.category]), `/admin/tickets/${ticket!.id}`);
    return ticket!;
  });
}

async function loadTicket(db: DbOrTx, actor: Actor, ticketId: string) {
  const [ticket] = await db.select().from(supportTickets).where(eq(supportTickets.id, ticketId));
  if (!ticket || (ticket.userId !== actor.id && !isStaff(actor.role))) fail('ticket_not_found', t('Запитването не е намерено.'), 404);
  return ticket!;
}

/** `discordMessageId`: the reply was written in the ticket's Discord channel (not sent back there). */
export async function replyToTicket(db: Database, actor: Actor, ticketId: string, body: string, discordMessageId?: string) {
  return db.transaction(async (tx) => {
    const ticket = await loadTicket(tx, actor, ticketId);
    const asStaff = ticket.userId !== actor.id && isStaff(actor.role);
    if (ticket.status === 'closed' && !asStaff) fail('ticket_closed', t('Запитването е затворено. Отворете ново.'));
    await tx.insert(supportMessages).values({ ticketId, authorId: actor.id, staff: asStaff, body, discordMessageId: discordMessageId ?? null });
    await tx.update(supportTickets).set({ status: asStaff ? 'answered' : 'open', updatedAt: new Date(), ...(asStaff && !ticket.assignedTo ? { assignedTo: actor.id } : {}) }).where(eq(supportTickets.id, ticketId));
    if (asStaff) await notify(tx, ticket.userId, 'info', () => t('Отговор от поддръжката: {0}', ticket.subject), body.slice(0, 140), `/game/support/${ticketId}`);
    else if (ticket.assignedTo) await notify(tx, ticket.assignedTo, 'info', () => t('Нов отговор от играч: {0}', ticket.subject), body.slice(0, 140), `/admin/tickets/${ticketId}`);
  });
}

export async function setTicketStatus(db: Database, actor: Actor, ticketId: string, status: keyof typeof TICKET_STATUS) {
  const ticket = await loadTicket(db, actor, ticketId);
  if (ticket.userId === actor.id && !isStaff(actor.role) && status !== 'closed') fail('forbidden', t('Можете само да затворите запитването.'), 403);
  await db.update(supportTickets).set({ status, updatedAt: new Date() }).where(eq(supportTickets.id, ticketId));
}

export async function assignTicket(db: Database, actor: Actor, ticketId: string) {
  if (!isStaff(actor.role)) fail('forbidden', t('Нямате права.'), 403);
  await loadTicket(db, actor, ticketId);
  await db.update(supportTickets).set({ assignedTo: actor.id, updatedAt: new Date() }).where(eq(supportTickets.id, ticketId));
}

export async function myTickets(db: DbOrTx, userId: string) {
  return db.select().from(supportTickets).where(eq(supportTickets.userId, userId)).orderBy(desc(supportTickets.updatedAt)).limit(50);
}

export async function ticketThread(db: DbOrTx, actor: Actor, ticketId: string) {
  const ticket = await loadTicket(db, actor, ticketId);
  const messages = await db
    .select({ id: supportMessages.id, body: supportMessages.body, staff: supportMessages.staff, createdAt: supportMessages.createdAt, author: users.username, authorRole: users.role })
    .from(supportMessages)
    .innerJoin(users, eq(users.id, supportMessages.authorId))
    .where(eq(supportMessages.ticketId, ticketId))
    .orderBy(supportMessages.id);
  const [owner] = await db.select({ id: users.id, username: users.username, email: users.email }).from(users).where(eq(users.id, ticket.userId));
  const assignee = ticket.assignedTo ? (await db.select({ username: users.username }).from(users).where(eq(users.id, ticket.assignedTo)))[0] : null;
  return { ticket, messages, owner: owner!, assignee: assignee?.username ?? null };
}

export async function staffTicketList(db: DbOrTx, status?: string) {
  const where = status && status in TICKET_STATUS ? eq(supportTickets.status, status) : undefined;
  return db
    .select({ ticket: supportTickets, username: users.username })
    .from(supportTickets)
    .innerJoin(users, eq(users.id, supportTickets.userId))
    .where(where)
    .orderBy(desc(supportTickets.updatedAt))
    .limit(200);
}

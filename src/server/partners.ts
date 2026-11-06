/**
 * 1.2.3.1 „За партньори“: the inquiries from the public page. They are stored
 * for the administrators (/admin/partners) and announced in #сигнали.
 */
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PARTNER_KINDS, PARTNER_LIMITS, partnerKindLabel } from '@/lib/game/partners';
import type { DbOrTx } from '@/server/db/client';
import { cities, deliveries, partnerInquiries, users } from '@/server/db/schema';
import { appUrl } from '@/server/discord/config';
import { announce } from '@/server/discord/outbox';
import { fail } from '@/server/game/errors';
import { t, tx } from '@/i18n/t';

export const INQUIRY_STATUSES = ['new', 'answered', 'archived'] as const;

export const partnerInquirySchema = z.object({
  kind: z.enum(PARTNER_KINDS, 'Избери за какво ни пишеш.'),
  name: z.string().trim().min(2, 'Напиши името си.').max(PARTNER_LIMITS.name),
  email: z.string().trim().toLowerCase().email('Невалиден имейл.').max(200),
  organization: z.string().trim().max(PARTNER_LIMITS.org).optional().default(''),
  link: z.string().trim().max(PARTNER_LIMITS.link).optional().default(''),
  message: z.string().trim().min(PARTNER_LIMITS.minMessage, 'Разкажи ни малко повече (поне 20 знака).').max(PARTNER_LIMITS.message),
  /** A field people do not see: bots fill it in. */
  website: z.string().max(200).optional().default(''),
});
export type PartnerInquiryInput = z.infer<typeof partnerInquirySchema>;

/** Stores an inquiry and tells the staff in Discord. Returns its id (null for a bot). */
export async function sendPartnerInquiry(db: DbOrTx, input: PartnerInquiryInput, from: { userId: string | null; ipHash: string | null }, now = new Date()): Promise<string | null> {
  // The hidden field is filled only by bots: answer „ok“ and store nothing.
  if (input.website) return null;
  if (input.link && !/^https?:\/\/\S+$/i.test(input.link)) fail('bad_link', t('Линкът трябва да започва с http:// или https://.'));
  const [row] = await db.insert(partnerInquiries).values({
    kind: input.kind,
    name: input.name,
    email: input.email,
    organization: input.organization || null,
    link: input.link || null,
    message: input.message,
    userId: from.userId,
    ipHash: from.ipHash,
    createdAt: now,
    updatedAt: now,
  }).returning({ id: partnerInquiries.id });
  await announce(db, `partner:${row!.id}`, 'staffAlerts', () => ({
    embeds: [{
      title: t('🤝 Ново запитване: {0}', tx(partnerKindLabel(input.kind))),
      description: `**${input.name}**${input.organization ? ` · ${input.organization}` : ''}\n${input.message.slice(0, 300)}${input.message.length > 300 ? '…' : ''}`,
      url: `${appUrl()}/admin/partners`,
      color: 0x2dd4bf,
      footer: { text: 'TransVerse · за партньори' },
    }],
  }), now);
  return row!.id;
}

export async function partnerInquiryList(db: DbOrTx, status: (typeof INQUIRY_STATUSES)[number] | 'all' = 'new', limit = 100) {
  const q = db.select().from(partnerInquiries);
  return (status === 'all' ? q : q.where(eq(partnerInquiries.status, status))).orderBy(desc(partnerInquiries.createdAt)).limit(limit);
}

export async function newPartnerInquiries(db: DbOrTx) {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(partnerInquiries).where(eq(partnerInquiries.status, 'new'));
  return row?.n ?? 0;
}

export async function setPartnerInquiry(db: DbOrTx, id: string, status: (typeof INQUIRY_STATUSES)[number], note: string | undefined, now = new Date()) {
  const [row] = await db.update(partnerInquiries).set({ status, ...(note !== undefined ? { staffNote: note || null } : {}), updatedAt: now }).where(eq(partnerInquiries.id, id)).returning({ id: partnerInquiries.id });
  if (!row) fail('not_found', t('Запитването не е намерено.'), 404);
}

/** Live numbers for the page (game data from the database, rounded down). */
export async function partnerFacts(db: DbOrTx) {
  const [[players], [trips], [places]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(users),
    db.select({ n: sql<number>`count(*)::int` }).from(deliveries).where(eq(deliveries.status, 'completed')),
    db.select({ cities: sql<number>`count(*)::int`, countries: sql<number>`count(distinct ${cities.countryCode})::int` }).from(cities),
  ]);
  return { players: players?.n ?? 0, deliveries: trips?.n ?? 0, cities: places?.cities ?? 0, countries: places?.countries ?? 0 };
}

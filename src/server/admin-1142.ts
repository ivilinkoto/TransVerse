import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, desc, eq, ilike, inArray } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { adminAudit, coinEntries, companies, contracts, deliveries, cities, ledgerEntries, notifications, supportTemplates, supportTickets, users } from '@/server/db/schema';
import { FEATURES, type FeatureId } from '@/lib/game/features';
import { RELEASES, compareVersions } from '@/lib/game/releases';
import { recordAudit, requireStaff, type Staff } from '@/server/admin';
import { fail } from '@/server/game/errors';
import { disabledFeatures } from '@/server/feature-switches';
import { t } from '@/i18n/t';

/**
 * 1.1.4.2 for the team: the history of the feature switches, „Готовност за
 * пускане“, a player's journey and reply templates for tickets.
 */

/** Who switched features off and on, when and why (from the audit log). */
export async function switchHistory(db: DbOrTx, limit = 20) {
  return db
    .select({ id: adminAudit.id, action: adminAudit.action, details: adminAudit.details, at: adminAudit.createdAt, actor: users.username })
    .from(adminAudit)
    .innerJoin(users, eq(users.id, adminAudit.actorId))
    .where(inArray(adminAudit.action, ['feature_off', 'feature_on']))
    .orderBy(desc(adminAudit.createdAt))
    .limit(limit);
}

/** The next release that is not out yet and how ready it is. */
export async function readiness(db: DbOrTx, now: Date, root = process.cwd()) {
  const next = [...RELEASES].filter((r) => new Date(r.publishedAt) > now).sort((a, b) => compareVersions(a.version, b.version))[0] ?? null;
  if (!next) return null;
  const features = (Object.keys(FEATURES) as FeatureId[]).filter((id) => FEATURES[id] === next.version);
  const off = await disabledFeatures(db, true);
  // Texts without an English or Russian translation (the same check as the i18n test).
  let missing = { en: 0, ru: 0, total: 0 };
  try {
    const keys = JSON.parse(readFileSync(join(root, 'messages', 'keys.json'), 'utf8')) as string[] | Record<string, unknown>;
    const list = Array.isArray(keys) ? keys : Object.keys(keys);
    const en = JSON.parse(readFileSync(join(root, 'messages', 'en.json'), 'utf8')) as Record<string, string>;
    const ru = JSON.parse(readFileSync(join(root, 'messages', 'ru.json'), 'utf8')) as Record<string, string>;
    missing = { en: list.filter((k) => !en[k]).length, ru: list.filter((k) => !ru[k]).length, total: list.length };
  } catch {
    /* the catalog is not readable here (it is in the build) */
  }
  const notes = next.sections.reduce((s, x) => s + x.items.length, 0) + next.highlights.length;
  return { release: next, features: features.map((id) => ({ id, off: off.has(id) })), missing, notes, hoursLeft: Math.round((new Date(next.publishedAt).getTime() - now.getTime()) / 3_600_000) };
}

export type JourneyItem = { at: Date; kind: 'money' | 'trip' | 'coins' | 'notice' | 'ticket' | 'staff'; text: string };

/** A player's last steps, newest first: money, trips, ТрансКоин, notifications, tickets and what the team did. */
export async function playerJourney(db: DbOrTx, query: string, limit = 120) {
  const q = query.trim();
  if (!q) return null;
  const [u] = /^[0-9a-f-]{36}$/i.test(q)
    ? await db.select({ id: users.id, username: users.username, createdAt: users.createdAt }).from(users).where(eq(users.id, q))
    : await db.select({ id: users.id, username: users.username, createdAt: users.createdAt }).from(users).where(ilike(users.username, q.replace(/[%_\\]/g, '\\$&')));
  if (!u) return { user: null, items: [] as JourneyItem[] };
  const [account] = await db.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, u.id));
  const [money, trips, coins, notes, tickets, staff] = await Promise.all([
    account ? db.select({ at: ledgerEntries.createdAt, cents: ledgerEntries.amountCents, text: ledgerEntries.description }).from(ledgerEntries).where(eq(ledgerEntries.companyId, account.id)).orderBy(desc(ledgerEntries.createdAt)).limit(40) : [],
    account ? db.select({ at: deliveries.startedAt, done: deliveries.completedAt, status: deliveries.status, goods: contracts.goods, to: cities.nameBg }).from(deliveries).innerJoin(contracts, eq(contracts.id, deliveries.contractId)).innerJoin(cities, eq(cities.id, contracts.destCityId)).where(eq(deliveries.companyId, account.id)).orderBy(desc(deliveries.startedAt)).limit(25) : [],
    db.select({ at: coinEntries.createdAt, amount: coinEntries.amount, text: coinEntries.description }).from(coinEntries).where(eq(coinEntries.userId, u.id)).orderBy(desc(coinEntries.createdAt)).limit(20),
    db.select({ at: notifications.createdAt, title: notifications.title }).from(notifications).where(eq(notifications.userId, u.id)).orderBy(desc(notifications.createdAt)).limit(25),
    db.select({ at: supportTickets.createdAt, subject: supportTickets.subject, status: supportTickets.status }).from(supportTickets).where(eq(supportTickets.userId, u.id)).orderBy(desc(supportTickets.createdAt)).limit(10),
    db.select({ at: adminAudit.createdAt, action: adminAudit.action }).from(adminAudit).where(and(eq(adminAudit.targetUserId, u.id))).orderBy(desc(adminAudit.createdAt)).limit(15),
  ]);
  const items: JourneyItem[] = [
    { at: u.createdAt, kind: 'staff' as const, text: t('Регистрация') },
    ...money.map((m) => ({ at: m.at, kind: 'money' as const, text: `${m.cents >= 0 ? '+' : ''}${(m.cents / 100).toFixed(2)} · ${m.text}` })),
    ...trips.map((d) => ({ at: d.done ?? d.at, kind: 'trip' as const, text: `${d.status === 'completed' ? '✓' : '▶'} ${d.goods} → ${d.to}` })),
    ...coins.map((c) => ({ at: c.at, kind: 'coins' as const, text: `${c.amount > 0 ? '+' : ''}${c.amount} TC · ${c.text}` })),
    ...notes.map((n) => ({ at: n.at, kind: 'notice' as const, text: String(n.title) })),
    ...tickets.map((x) => ({ at: x.at, kind: 'ticket' as const, text: `${x.subject} (${x.status})` })),
    ...staff.map((s) => ({ at: s.at, kind: 'staff' as const, text: s.action })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  return { user: u, items: items.slice(0, limit) };
}

export async function supportTemplatesList(db: DbOrTx) {
  return db.select().from(supportTemplates).orderBy(supportTemplates.title);
}

export async function saveSupportTemplate(db: DbOrTx, actor: Staff | null, title: string, body: string) {
  requireStaff(actor);
  if (title.trim().length < 2 || body.trim().length < 5) fail('bad_template', t('Дай заглавие и текст.'));
  const [row] = await db.insert(supportTemplates).values({ title: title.trim().slice(0, 80), body: body.trim().slice(0, 4000), createdBy: actor!.id }).returning();
  await recordAudit(db, actor!.id, 'support_template', null, { title: row!.title });
  return row!;
}

export async function deleteSupportTemplate(db: DbOrTx, actor: Staff | null, id: string) {
  requireStaff(actor);
  await db.delete(supportTemplates).where(eq(supportTemplates.id, id));
}

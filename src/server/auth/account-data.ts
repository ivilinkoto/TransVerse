import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { registerSchema } from './accounts';
import type { Database, DbOrTx } from '@/server/db/client';
import { activity, coinEntries, companies, contracts, deliveries, friendships, ledgerEntries, sessions, users, vehicles } from '@/server/db/schema';
import { fail } from '@/server/game/errors';
import { logActivity } from '@/server/game/notify';
import { deviceLabel } from '@/lib/device';
import { date } from '@/lib/format';
import { t } from '@/i18n/t';

/**
 * 1.1.3: everything the game keeps about the player, as one JSON file (GDPR:
 * the right to a copy). No password hash, no session ids, no other players' data
 * beyond what the player sees in the game.
 */
export async function exportAccount(db: DbOrTx, userId: string, now = new Date()) {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) fail('user_not_found', t('Профилът не е намерен.'), 404);
  const { passwordHash: _hash, signupIpHash: _ip, ...profile } = u!;
  const [company] = await db.select().from(companies).where(eq(companies.ownerId, userId));
  const [fleet, trips, ledger, coins, logins, devices, friends] = await Promise.all([
    company ? db.select({ plate: vehicles.plate, modelId: vehicles.modelId, ownership: vehicles.ownership, purchasedAt: vehicles.purchasedAt, soldAt: vehicles.soldAt, odometerKm: vehicles.odometerKm }).from(vehicles).where(eq(vehicles.companyId, company.id)) : [],
    company
      ? db
          .select({ goods: contracts.goods, originCityId: contracts.originCityId, destCityId: contracts.destCityId, startedAt: deliveries.startedAt, completedAt: deliveries.completedAt, late: deliveries.late, payoutCents: deliveries.payoutCents, loadedKm: deliveries.loadedKm })
          .from(deliveries)
          .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
          .where(eq(deliveries.companyId, company.id))
          .orderBy(desc(deliveries.startedAt))
          .limit(5000)
      : [],
    company ? db.select({ at: ledgerEntries.createdAt, category: ledgerEntries.category, amountCents: ledgerEntries.amountCents, description: ledgerEntries.description }).from(ledgerEntries).where(eq(ledgerEntries.companyId, company.id)).orderBy(desc(ledgerEntries.id)).limit(10000) : [],
    db.select({ at: coinEntries.createdAt, amount: coinEntries.amount, reason: coinEntries.reason, description: coinEntries.description }).from(coinEntries).where(eq(coinEntries.userId, userId)).orderBy(desc(coinEntries.id)).limit(5000),
    db.select({ at: activity.createdAt, details: activity.details }).from(activity).where(and(eq(activity.userId, userId), eq(activity.action, 'login_device'), gte(activity.createdAt, new Date(now.getTime() - 180 * 86_400_000)))).orderBy(desc(activity.createdAt)).limit(1000),
    db.select({ userAgent: sessions.userAgent, createdAt: sessions.createdAt }).from(sessions).where(eq(sessions.userId, userId)),
    db.execute<{ username: string; status: string }>(sql`select u.username, f.status from ${friendships} f join users u on u.id = case when f.requester_id = ${userId} then f.addressee_id else f.requester_id end where f.requester_id = ${userId} or f.addressee_id = ${userId}`).then((r) => r.rows),
  ]);
  await logActivity(db, userId, 'data_exported');
  return {
    exportedAt: now.toISOString(),
    note: 'TransVerse — данните на профила ти. Икономиката в играта е игрова (измислена), географията е истинска.',
    profile,
    account: company ? { kind: company.kind, balanceCents: company.balanceCents, deliveries: company.deliveries, totalKm: company.totalKm, reputation: company.reputation, createdAt: company.createdAt } : null,
    vehicles: fleet,
    deliveries: trips,
    ledger,
    transCoin: coins,
    signIns: logins.map((l) => ({ at: l.at, device: (l.details as { device?: string }).device ?? null })),
    signedInDevices: devices.map((d) => ({ device: deviceLabel(d.userAgent), since: d.createdAt })),
    friends,
  };
}

/** 1.1.3: a new username, once every 30 days. */
export const USERNAME_CHANGE_DAYS = 30;
export const usernameSchema = registerSchema.shape.username;

export async function lastUsernameChange(db: DbOrTx, userId: string): Promise<Date | null> {
  const [row] = await db.select({ at: activity.createdAt }).from(activity).where(and(eq(activity.userId, userId), eq(activity.action, 'username_changed'))).orderBy(desc(activity.createdAt)).limit(1);
  return row?.at ?? null;
}

export async function changeUsername(db: Database, userId: string, raw: string, now = new Date()) {
  const username = usernameSchema.parse(raw);
  if (/^deleted-/i.test(username)) fail('username_reserved', t('Това име е запазено.'));
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ username: users.username }).from(users).where(eq(users.id, userId)).for('update');
    if (!u) fail('user_not_found', t('Профилът не е намерен.'), 404);
    if (u!.username === username) fail('same_username', t('Това вече е твоето име.'));
    const last = await lastUsernameChange(tx, userId);
    if (last && now.getTime() - last.getTime() < USERNAME_CHANGE_DAYS * 86_400_000) {
      const next = new Date(last.getTime() + USERNAME_CHANGE_DAYS * 86_400_000);
      fail('username_cooldown', t('Името се сменя веднъж на {0} дни — следващата смяна е възможна след {1}.', USERNAME_CHANGE_DAYS, date(next)));
    }
    // Only case changes of the own name are allowed against the unique index.
    const [taken] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = ${username.toLowerCase()} and ${users.id} <> ${userId}`);
    if (taken) fail('username_taken', t('Това потребителско име е заето.'), 409);
    await tx.update(users).set({ username }).where(eq(users.id, userId));
    await tx.insert(activity).values({ userId, action: 'username_changed', details: { from: u!.username, to: username }, createdAt: now });
    return username;
  });
}

import { randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { DbOrTx } from '@/server/db/client';
import { cities, companies, contracts, deliveries, trackLinks, users, vehicles } from '@/server/db/schema';
import { t } from '@/i18n/t';
import { companyForUser } from './company';
import { fail } from './errors';

/** 1.1.4.2 „Проследяване на живо“: a public link to a trip (no account needed to look). */
export async function trackLink(db: DbOrTx, userId: string, deliveryId: string) {
  const company = await companyForUser(db, userId);
  const [d] = await db.select({ id: deliveries.id }).from(deliveries).where(and(eq(deliveries.id, deliveryId), eq(deliveries.companyId, company.id)));
  if (!d) fail('delivery_not_found', t('Курсът не е намерен.'), 404);
  const [old] = await db.select({ token: trackLinks.token }).from(trackLinks).where(eq(trackLinks.deliveryId, deliveryId));
  if (old) return old.token;
  const token = randomBytes(9).toString('base64url');
  await db.insert(trackLinks).values({ token, deliveryId, userId }).onConflictDoNothing();
  const [row] = await db.select({ token: trackLinks.token }).from(trackLinks).where(eq(trackLinks.deliveryId, deliveryId));
  return row!.token;
}

/** What the public page shows (no money, nothing private). */
export async function trackView(db: DbOrTx, token: string) {
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(token)) return null;
  const origin = alias(cities, 'origin');
  const dest = alias(cities, 'dest');
  const [row] = await db
    .select({
      goods: contracts.goods,
      from: origin.nameBg,
      to: dest.nameBg,
      fromLat: origin.lat,
      fromLon: origin.lon,
      toLat: dest.lat,
      toLon: dest.lon,
      km: deliveries.loadedKm,
      startedAt: deliveries.startedAt,
      etaAt: deliveries.etaAt,
      status: deliveries.status,
      username: users.username,
      plate: vehicles.plate,
      nickname: vehicles.nickname,
      modelId: vehicles.modelId,
    })
    .from(trackLinks)
    .innerJoin(deliveries, eq(deliveries.id, trackLinks.deliveryId))
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .innerJoin(origin, eq(origin.id, contracts.originCityId))
    .innerJoin(dest, eq(dest.id, contracts.destCityId))
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .innerJoin(users, eq(users.id, trackLinks.userId))
    .innerJoin(vehicles, eq(vehicles.id, deliveries.vehicleId))
    .where(eq(trackLinks.token, token));
  if (!row) return null;
  await db.update(trackLinks).set({ views: sql`${trackLinks.views} + 1` }).where(eq(trackLinks.token, token));
  return row;
}

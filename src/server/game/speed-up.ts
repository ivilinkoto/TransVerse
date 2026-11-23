/**
 * 1.3.2.2: hurry a running delivery with ТрансКоин (rules in src/lib/game/speed-up.ts).
 * „Arrive now“ settles the trip at once.
 */
import { and, eq } from 'drizzle-orm';
import { hurrySchedule, speedUpPrice, type SpeedUpMode } from '@/lib/game/speed-up';
import { scheduleEnd, type Segment } from '@/lib/game/schedule';
import { isVip } from '@/lib/game/vip';
import type { Database } from '@/server/db/client';
import { deliveries, users } from '@/server/db/schema';
import { postCoins } from './coins';
import { companyForUser } from './company';
import { settleDueDeliveries } from './deliveries';
import { fail } from './errors';
import { t } from '@/i18n/t';

export async function speedUpDelivery(db: Database, userId: string, deliveryId: string, mode: SpeedUpMode, now = new Date()) {
  const done = await db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const [d] = await tx.select().from(deliveries).where(and(eq(deliveries.id, deliveryId), eq(deliveries.companyId, company.id), eq(deliveries.status, 'in_progress'))).for('update');
    if (!d) fail('delivery_not_found', t('Курсът не е намерен или вече е приключил.'), 404);
    if (d!.convoyWith || d!.convoyLead || d!.organizedConvoyId) fail('convoy', t('Курс в конвой не може да се ускори — другите го чакат.'));
    const left = d!.etaAt.getTime() - now.getTime();
    if (left <= 60_000) fail('almost_there', t('Камионът пристига до минута.'));
    const [u] = await tx.select({ vipUntil: users.vipUntil }).from(users).where(eq(users.id, userId));
    const price = speedUpPrice(left, mode, isVip(u?.vipUntil, now));
    await postCoins(tx, userId, { amount: -price, reason: 'shop', description: mode === 'finish' ? t('Пристигни сега') : t('Ускоряване на курса (−50%)'), idempotencyKey: `speed-up:${d!.id}:${mode}:${now.getTime()}` }, { requireFunds: true });
    const factor = mode === 'finish' ? 0 : 0.5;
    const schedule = hurrySchedule(d!.schedule as Segment[], now.getTime(), factor);
    const eta = scheduleEnd(schedule);
    const squeeze = (at: Date | null) => (at && at.getTime() > now.getTime() ? new Date(now.getTime() + (at.getTime() - now.getTime()) * ((eta - now.getTime()) / left)) : at);
    await tx.update(deliveries).set({ schedule, etaAt: new Date(eta), nextEventAt: squeeze(d!.nextEventAt) }).where(eq(deliveries.id, d!.id));
    return { price, etaAt: new Date(eta), companyId: company.id };
  });
  // „Arrive now“: the trip is paid right away.
  if (mode === 'finish') await settleDueDeliveries(db, new Date(done.etaAt.getTime() + 1), done.companyId);
  return { price: done.price, etaAt: done.etaAt };
}

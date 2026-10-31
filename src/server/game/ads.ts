import { and, count, eq, gt, inArray, lte } from 'drizzle-orm';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { adContracts } from '@/server/db/schema';
import { ADS, adOffers } from '@/lib/game/ads';
import { weekKey } from '@/lib/game/leagues';
import { t } from '@/i18n/t';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { notify } from './notify';

/** 1.1.4.2 „Реклама по ремаркето“: the week's offers and the company's adverts. */
export async function adsFor(db: DbOrTx, companyId: string, now = new Date()) {
  const week = weekKey(now);
  const mine = await db.select().from(adContracts).where(eq(adContracts.companyId, companyId));
  const taken = new Set(mine.map((a) => a.offerKey));
  return { offers: adOffers(week, companyId).filter((o) => !taken.has(o.key)), ads: mine.filter((a) => a.status === 'active' || a.createdAt > new Date(now.getTime() - 14 * 86_400_000)) };
}

export async function takeAd(db: Database, userId: string, key: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const offer = adOffers(weekKey(now), company.id).find((o) => o.key === key);
    if (!offer) fail('ad_gone', t('Тази оферта вече не е налична.'), 409);
    const [{ n = 0 } = {}] = await tx.select({ n: count() }).from(adContracts).where(and(eq(adContracts.companyId, company.id), eq(adContracts.status, 'active')));
    if (n >= ADS.maxActive) fail('ads_full', t('Най-много {0} реклами наведнъж.', ADS.maxActive));
    const [row] = await tx
      .insert(adContracts)
      .values({ companyId: company.id, offerKey: offer!.key, brand: offer!.brand, country: offer!.country, targetKm: offer!.targetKm, payCents: offer!.payCents, rule: offer!.rule, endsAt: new Date(now.getTime() + ADS.days * 86_400_000) })
      .onConflictDoNothing()
      .returning();
    if (!row) fail('ad_gone', t('Тази оферта вече не е налична.'), 409);
    return row!;
  });
}

/** After a delivery: kilometres in the advert's country count (only on time for some brands). */
export async function recordAdKm(tx: Tx, companyId: string, userId: string, countries: readonly string[], km: number, onTime: boolean, now: Date) {
  const active = await tx.select().from(adContracts).where(and(eq(adContracts.companyId, companyId), eq(adContracts.status, 'active'), gt(adContracts.endsAt, now), inArray(adContracts.country, countries.length ? [...countries] : ['--'])));
  for (const ad of active) {
    if (ad.rule === 'on_time' && !onTime) continue;
    const progress = ad.progressKm + km;
    const done = progress >= ad.targetKm;
    await tx.update(adContracts).set({ progressKm: Math.min(progress, ad.targetKm), status: done ? 'done' : 'active' }).where(eq(adContracts.id, ad.id));
    if (done) {
      await post(tx, companyId, [{ category: 'ad_pay', amountCents: ad.payCents, description: t('Реклама: {0}', ad.brand), idempotencyKey: `ad:${ad.id}` }]);
      await notify(tx, userId, 'success', () => t('📣 Рекламата на {0} е изпълнена', ad.brand), () => t('+{0} лв. по сметката.', Math.round(ad.payCents / 100)), '/game/growth');
    }
  }
}

/** Worker: adverts past their week fail. */
export async function expireAds(db: DbOrTx, now = new Date()) {
  const gone = await db.update(adContracts).set({ status: 'failed' }).where(and(eq(adContracts.status, 'active'), lte(adContracts.endsAt, now))).returning({ id: adContracts.id });
  return gone.length;
}

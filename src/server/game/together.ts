import { and, eq, inArray, lte, or, sql } from 'drizzle-orm';
import { coinsAsMoney } from '@/lib/game/coin-cap';
import { money } from '@/lib/format';
import { canSplit } from '@/lib/game/partial';
import { DAILY_LOAD, SHARED_LOAD } from '@/lib/game/together';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, contracts, deliveries, sharedLoads, userBadges, users } from '@/server/db/schema';
import { enqueue } from '@/server/discord/outbox';
import { featureFor } from '@/server/features';
import { postCoins } from './coins';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { membershipOf, notifyMembers } from './membership';
import { broadcast, notify } from './notify';
import { t as tr, intlLocale } from '@/i18n/t';

// ── Shared loads ─────────────────────────────────────────────────────────

/**
 * A member shares a big board load with the company: from now on only the
 * members see it and take parts of it (partial loads). When every part has
 * arrived on time, each part gets a bonus on its pay.
 */
export async function shareLoad(db: Database, userId: string, contractId: string, now = new Date()) {
  if (!(await featureFor(db, userId, 'shared_loads', now))) fail('not_released', tr('Това идва със следващото обновление.'), 403);
  return db.transaction(async (tx) => {
    const m = await membershipOf(tx, userId);
    if (!m) fail('no_company', tr('Общ товар се споделя с компанията — първо се присъедини към компания.'));
    const [c] = await tx.select().from(contracts).where(eq(contracts.id, contractId)).for('update');
    if (!c || c.status !== 'open' || c.expiresAt <= now) fail('contract_unavailable', tr('Поръчката вече не е налична.'), 409);
    if (c!.sharedLoadId) fail('already_shared', tr('Товарът вече е общ.'));
    if (!canSplit(c!)) fail('no_partial', tr('Този товар не може да се дели.'));
    if (c!.weightTons < SHARED_LOAD.minTons) fail('too_small', tr('Споделят се товари от поне {0} т.', SHARED_LOAD.minTons));
    if (c!.reservedUntil && c!.reservedUntil > now) {
      const account = await companyForUser(tx, userId);
      if (c!.reservedByCompanyId !== account.id) fail('reserved', tr('Поръчката е запазена от друг играч.'), 409);
    }
    const [{ open = 0 } = {}] = await tx.select({ open: sql<number>`count(*)::int` }).from(sharedLoads).where(and(eq(sharedLoads.organizationId, m!.company.id), eq(sharedLoads.status, 'open')));
    if (open >= SHARED_LOAD.maxOpen) fail('too_many', tr('Компанията може да има до {0} общи товара наведнъж.', SHARED_LOAD.maxOpen));
    const [shared] = await tx.insert(sharedLoads).values({ contractId, organizationId: m!.company.id, sharedBy: userId, tons: c!.weightTons, createdAt: now }).returning();
    await tx.update(contracts).set({ sharedLoadId: shared!.id, reservedByCompanyId: null, reservedUntil: null }).where(eq(contracts.id, contractId));
    const names = await tx.select({ id: cities.id, nameBg: cities.nameBg }).from(cities).where(inArray(cities.id, [c!.originCityId, c!.destCityId]));
    const name = (id: number) => names.find((x) => x.id === id)?.nameBg ?? '';
    const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, userId));
    const lane = `${name(c!.originCityId)} → ${name(c!.destCityId)}`;
    const bonus = `${Math.round(SHARED_LOAD.bonusShare * 100)} %`;
    await notifyMembers(tx, m!.company.id, null, () => tr('Общ товар: {0}, {1}', c!.goods, lane), () => tr('{0} сподели {1} т с компанията. Вземете по част — ако всички части стигнат навреме, всеки получава +{2}.', me!.username, c!.weightTons, bonus), `/game/contracts?load=${contractId}`);
    // The company's Discord channel, with a button to take a part.
    await enqueue(tx, `shared:${shared!.id}`, `company:${m!.company.id}`, {
      username: 'TransVerse',
      embeds: [{ title: tr('📦 Общ товар: {0}', c!.goods), color: 0x22d3ee, description: tr('**{0}** · {1} т · {2}\n{3} го сподели с компанията. Вземете по част — ако всички части стигнат навреме, всеки получава **+{4}**.', lane, c!.weightTons, money(c!.rewardCents), me!.username, bonus), footer: { text: tr('Изтича {0}', c!.expiresAt.toLocaleString(intlLocale(), { timeZone: 'Europe/Sofia', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })) } }],
      components: [{ type: 1, components: [{ type: 2, style: 1, label: tr('Вземи част'), custom_id: `take:${contractId}`, emoji: { name: '✂️' } }] }],
    }, now);
    await broadcast(tx, 'market');
    return shared!;
  });
}

/** May this player take a load shared with a company? Only its members. */
export async function checkSharedLoad(tx: DbOrTx, sharedLoadId: string, userId: string) {
  const [s] = await tx.select({ organizationId: sharedLoads.organizationId }).from(sharedLoads).where(eq(sharedLoads.id, sharedLoadId));
  const m = await membershipOf(tx, userId);
  if (!s || m?.company.id !== s.organizationId) fail('members_only', tr('Това е общ товар на друга компания.'), 403);
}

/**
 * A part of a shared load arrived. When nothing is left on the board and no
 * part is on the road, the shared load ends: all on time → the bonus to each
 * part (and the "Отборен товар" badge), otherwise nothing.
 */
export async function settleSharedPart(tx: Tx, sharedLoadId: string, now: Date) {
  const [s] = await tx.select().from(sharedLoads).where(and(eq(sharedLoads.id, sharedLoadId), eq(sharedLoads.status, 'open'))).for('update');
  if (!s) return null;
  const parts = await tx.select({ id: contracts.id, status: contracts.status, rewardCents: contracts.rewardCents, goods: contracts.goods }).from(contracts).where(eq(contracts.sharedLoadId, sharedLoadId));
  if (parts.some((p) => p.status === 'open')) return null;
  const trips = parts.length ? await tx.select({ id: deliveries.id, contractId: deliveries.contractId, companyId: deliveries.companyId, status: deliveries.status, late: deliveries.late }).from(deliveries).where(inArray(deliveries.contractId, parts.map((p) => p.id))) : [];
  if (trips.some((t) => t.status === 'in_progress')) return null;
  const whole = parts.every((p) => p.status === 'accepted') && trips.length > 0;
  const onTime = whole && trips.every((t) => t.late === false);
  await tx.update(sharedLoads).set({ status: onTime ? 'done' : 'failed', closedAt: now }).where(eq(sharedLoads.id, s.id));
  const owners = await tx.select({ companyId: companies.id, userId: companies.ownerId }).from(companies).where(inArray(companies.id, [...new Set(trips.map((t) => t.companyId))]));
  const ownerOf = new Map(owners.map((o) => [o.companyId, o.userId]));
  if (onTime) {
    for (const t of trips) {
      const part = parts.find((p) => p.id === t.contractId)!;
      const bonus = Math.round(part.rewardCents * SHARED_LOAD.bonusShare);
      await post(tx, t.companyId, [{ category: 'shared_load_bonus', amountCents: bonus, description: tr('Общ товар: {0}', part.goods), idempotencyKey: `shared:${s.id}:${t.id}`, refType: 'delivery', refId: t.id }]);
      const userId = ownerOf.get(t.companyId);
      if (userId) await tx.insert(userBadges).values({ userId, badge: 'team-haul', awardedAt: now }).onConflictDoNothing();
    }
  }
  const goods = parts[0]?.goods ?? tr('товар');
  await notifyMembers(tx, s.organizationId, null, () => onTime ? tr('Общият товар стигна! 🎉') : tr('Общият товар не стигна навреме'), () => onTime ? tr('{0}: всички {1} части пристигнаха навреме — всеки получи +{2} % от своята част.', goods, trips.length, Math.round(SHARED_LOAD.bonusShare * 100)) : tr('{0}: {1}, затова няма бонус.', goods, whole ? tr('част закъсня') : tr('не всички тонове бяха взети')), '/game/finance');
  return onTime;
}

/** Worker: shared loads whose rest ran out on the board, with nothing on the road, end without a bonus. */
export async function closeExpiredSharedLoads(db: Database, now = new Date()) {
  const stale = await db
    .select({ id: sharedLoads.id })
    .from(sharedLoads)
    .innerJoin(contracts, eq(contracts.id, sharedLoads.contractId))
    .where(and(eq(sharedLoads.status, 'open'), or(eq(contracts.status, 'expired'), lte(contracts.expiresAt, now))))
    .limit(50);
  let n = 0;
  for (const { id } of stale) {
    await db.transaction(async (tx) => {
      // The rest of the load left the board.
      await tx.update(contracts).set({ status: 'expired' }).where(and(eq(contracts.sharedLoadId, id), eq(contracts.status, 'open'), lte(contracts.expiresAt, now)));
      if ((await settleSharedPart(tx, id, now)) !== null) n++;
    });
  }
  return n;
}

// ── The load of the day ──────────────────────────────────────────────────

/** The load of the day arrived on time: ТрансКоин for the driver (once). */
export async function deliverDailyLoad(tx: Tx, contract: { id: string; goods: string }, userId: string) {
  if (await postCoins(tx, userId, { amount: DAILY_LOAD.coins, reason: 'daily_load', description: tr('Товар на деня: {0}', contract.goods), idempotencyKey: `daily-load:${contract.id}` })) {
    await notify(tx, userId, 'success', () => tr('Товарът на деня е доставен! ⭐'), () => tr('+{0} за доставката навреме.', coinsAsMoney(DAILY_LOAD.coins)), '/game/shop');
  }
}

import { and, eq, inArray, lte, or, sql } from 'drizzle-orm';
import { money } from '@/lib/format';
import { canSplit } from '@/lib/game/partial';
import { DAILY_LOAD, DUEL, duelWinner, SHARED_LOAD } from '@/lib/game/together';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, contracts, deliveries, duels, sharedLoads, userBadges, users } from '@/server/db/schema';
import { enqueue } from '@/server/discord/outbox';
import { featureFor } from '@/server/features';
import { postCoins } from './coins';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { membershipOf, notifyMembers } from './membership';
import { broadcast, notify } from './notify';

// ── Shared loads ─────────────────────────────────────────────────────────

/**
 * A member shares a big board load with the company: from now on only the
 * members see it and take parts of it (partial loads). When every part has
 * arrived on time, each part gets a bonus on its pay.
 */
export async function shareLoad(db: Database, userId: string, contractId: string, now = new Date()) {
  if (!(await featureFor(db, userId, 'shared_loads', now))) fail('not_released', 'Това идва със следващото обновление.', 403);
  return db.transaction(async (tx) => {
    const m = await membershipOf(tx, userId);
    if (!m) fail('no_company', 'Общ товар се споделя с компанията — първо се присъедини към компания.');
    const [c] = await tx.select().from(contracts).where(eq(contracts.id, contractId)).for('update');
    if (!c || c.status !== 'open' || c.expiresAt <= now) fail('contract_unavailable', 'Поръчката вече не е налична.', 409);
    if (c!.sharedLoadId) fail('already_shared', 'Товарът вече е общ.');
    if (!canSplit(c!)) fail('no_partial', 'Този товар не може да се дели.');
    if (c!.weightTons < SHARED_LOAD.minTons) fail('too_small', `Споделят се товари от поне ${SHARED_LOAD.minTons} т.`);
    if (c!.reservedUntil && c!.reservedUntil > now) {
      const account = await companyForUser(tx, userId);
      if (c!.reservedByCompanyId !== account.id) fail('reserved', 'Поръчката е запазена от друг играч.', 409);
    }
    const [{ open = 0 } = {}] = await tx.select({ open: sql<number>`count(*)::int` }).from(sharedLoads).where(and(eq(sharedLoads.organizationId, m!.company.id), eq(sharedLoads.status, 'open')));
    if (open >= SHARED_LOAD.maxOpen) fail('too_many', `Компанията може да има до ${SHARED_LOAD.maxOpen} общи товара наведнъж.`);
    const [shared] = await tx.insert(sharedLoads).values({ contractId, organizationId: m!.company.id, sharedBy: userId, tons: c!.weightTons, createdAt: now }).returning();
    await tx.update(contracts).set({ sharedLoadId: shared!.id, reservedByCompanyId: null, reservedUntil: null }).where(eq(contracts.id, contractId));
    const names = await tx.select({ id: cities.id, nameBg: cities.nameBg }).from(cities).where(inArray(cities.id, [c!.originCityId, c!.destCityId]));
    const name = (id: number) => names.find((x) => x.id === id)?.nameBg ?? '';
    const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, userId));
    const lane = `${name(c!.originCityId)} → ${name(c!.destCityId)}`;
    const bonus = `${Math.round(SHARED_LOAD.bonusShare * 100)} %`;
    await notifyMembers(tx, m!.company.id, null, `Общ товар: ${c!.goods}, ${lane}`, `${me!.username} сподели ${c!.weightTons} т с компанията. Вземете по част — ако всички части стигнат навреме, всеки получава +${bonus}.`, `/game/contracts?load=${contractId}`);
    // The company's Discord channel, with a button to take a part.
    await enqueue(tx, `shared:${shared!.id}`, `company:${m!.company.id}`, {
      username: 'TransVerse',
      embeds: [{ title: `📦 Общ товар: ${c!.goods}`, color: 0x22d3ee, description: `**${lane}** · ${c!.weightTons} т · ${money(c!.rewardCents)}\n${me!.username} го сподели с компанията. Вземете по част — ако всички части стигнат навреме, всеки получава **+${bonus}**.`, footer: { text: `Изтича ${c!.expiresAt.toLocaleString('bg-BG', { timeZone: 'Europe/Sofia', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` } }],
      components: [{ type: 1, components: [{ type: 2, style: 1, label: 'Вземи част', custom_id: `take:${contractId}`, emoji: { name: '✂️' } }] }],
    }, now);
    await broadcast(tx, 'market');
    return shared!;
  });
}

/** May this player take a load shared with a company? Only its members. */
export async function checkSharedLoad(tx: DbOrTx, sharedLoadId: string, userId: string) {
  const [s] = await tx.select({ organizationId: sharedLoads.organizationId }).from(sharedLoads).where(eq(sharedLoads.id, sharedLoadId));
  const m = await membershipOf(tx, userId);
  if (!s || m?.company.id !== s.organizationId) fail('members_only', 'Това е общ товар на друга компания.', 403);
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
      await post(tx, t.companyId, [{ category: 'shared_load_bonus', amountCents: bonus, description: `Общ товар: ${part.goods}`, idempotencyKey: `shared:${s.id}:${t.id}`, refType: 'delivery', refId: t.id }]);
      const userId = ownerOf.get(t.companyId);
      if (userId) await tx.insert(userBadges).values({ userId, badge: 'team-haul', awardedAt: now }).onConflictDoNothing();
    }
  }
  const goods = parts[0]?.goods ?? 'товар';
  await notifyMembers(tx, s.organizationId, null, onTime ? `Общият товар стигна! 🎉` : 'Общият товар не стигна навреме', onTime ? `${goods}: всички ${trips.length} части пристигнаха навреме — всеки получи +${Math.round(SHARED_LOAD.bonusShare * 100)} % от своята част.` : `${goods}: ${whole ? 'част закъсня' : 'не всички тонове бяха взети'}, затова няма бонус.`, '/game/finance');
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
  if (await postCoins(tx, userId, { amount: DAILY_LOAD.coins, reason: 'daily_load', description: `Товар на деня: ${contract.goods}`, idempotencyKey: `daily-load:${contract.id}` })) {
    await notify(tx, userId, 'success', 'Товарът на деня е доставен! ⭐', `+${DAILY_LOAD.coins} ТрансКоин за доставката навреме.`, '/game/shop');
  }
}

// ── Duels ────────────────────────────────────────────────────────────────

const pair = (a: string, b: string) => or(and(eq(duels.challengerId, a), eq(duels.opponentId, b)), and(eq(duels.challengerId, b), eq(duels.opponentId, a)));
const openStatus = inArray(duels.status, ['pending', 'active']);

/** A player challenges another to a week of hauling: who carries more tonnes. */
export async function challengeDuel(db: Database, userId: string, opponentId: string, now = new Date()) {
  if (userId === opponentId) fail('self', 'Не можеш да се дуелираш със себе си.');
  return db.transaction(async (tx) => {
    const both = await tx.select({ id: users.id, username: users.username, bannedAt: users.bannedAt }).from(users).where(inArray(users.id, [userId, opponentId]));
    const me = both.find((u) => u.id === userId);
    const rival = both.find((u) => u.id === opponentId);
    if (!rival || rival.bannedAt) fail('not_found', 'Няма такъв играч.', 404);
    // One open duel per pair; a few at a time per player.
    const [same] = await tx.select({ id: duels.id }).from(duels).where(and(pair(userId, opponentId), openStatus));
    if (same) fail('already', `Вече имате дуел с ${rival!.username}.`);
    for (const id of [userId, opponentId]) {
      const [{ n = 0 } = {}] = await tx.select({ n: sql<number>`count(*)::int` }).from(duels).where(and(or(eq(duels.challengerId, id), eq(duels.opponentId, id)), openStatus));
      if (n >= DUEL.maxOpen) fail('too_many', id === userId ? `Може да имаш до ${DUEL.maxOpen} дуела наведнъж.` : `${rival!.username} вече има ${DUEL.maxOpen} дуела.`);
    }
    const [d] = await tx.insert(duels).values({ challengerId: userId, opponentId, createdAt: now }).returning();
    await notify(tx, opponentId, 'info', `${me!.username} те предизвика на дуел ⚔️`, `Кой ще превози повече тонове за ${DUEL.days} дни? Победителят печели ${DUEL.coins} ТрансКоин. Приеми до ${DUEL.pendingHours} часа.`, `/game/duels?duel=${d!.id}`);
    return d!;
  });
}

/** The challenged player accepts (the week starts now) or declines. */
export async function respondDuel(db: Database, userId: string, duelId: string, accept: boolean, now = new Date()) {
  return db.transaction(async (tx) => {
    const [d] = await tx.select().from(duels).where(eq(duels.id, duelId)).for('update');
    if (!d || d.opponentId !== userId) fail('not_found', 'Няма такава покана.', 404);
    if (d!.status !== 'pending' || d!.createdAt.getTime() + DUEL.pendingHours * 3_600_000 <= now.getTime()) fail('expired', 'Поканата вече не е активна.', 409);
    const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, userId));
    if (!accept) {
      await tx.update(duels).set({ status: 'declined', settledAt: now }).where(eq(duels.id, d!.id));
      await notify(tx, d!.challengerId, 'info', `${me!.username} отказа дуела`, 'Предизвикай някой друг!', '/game/duels');
      return { status: 'declined' as const };
    }
    const endsAt = new Date(now.getTime() + DUEL.days * 86_400_000);
    await tx.update(duels).set({ status: 'active', startsAt: now, endsAt }).where(eq(duels.id, d!.id));
    await notify(tx, d!.challengerId, 'success', `${me!.username} прие дуела ⚔️`, `Броят се тоновете, които превозите до ${endsAt.toLocaleString('bg-BG', { timeZone: 'Europe/Sofia', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.`, '/game/duels');
    return { status: 'active' as const, endsAt };
  });
}

/** A delivery of a player in a running duel: its tonnes count. */
export async function recordDuelDelivery(tx: Tx, userId: string, tons: number, at: Date) {
  const running = and(eq(duels.status, 'active'), lte(duels.startsAt, at), sql`${duels.endsAt} > ${at}`);
  await tx.update(duels).set({ challengerTons: sql`${duels.challengerTons} + ${tons}` }).where(and(running, eq(duels.challengerId, userId)));
  await tx.update(duels).set({ opponentTons: sql`${duels.opponentTons} + ${tons}` }).where(and(running, eq(duels.opponentId, userId)));
}

/** Worker: ends the duels whose week is over (prize and badge to the winner) and old invitations. */
export async function settleDuels(db: Database, now = new Date()) {
  await db.update(duels).set({ status: 'expired', settledAt: now }).where(and(eq(duels.status, 'pending'), lte(duels.createdAt, new Date(now.getTime() - DUEL.pendingHours * 3_600_000))));
  const due = await db.select({ id: duels.id }).from(duels).where(and(eq(duels.status, 'active'), lte(duels.endsAt, now))).limit(100);
  for (const { id } of due) {
    await db.transaction(async (tx) => {
      const [d] = await tx.select().from(duels).where(and(eq(duels.id, id), eq(duels.status, 'active'))).for('update');
      if (!d) return;
      const winnerId = duelWinner(d);
      await tx.update(duels).set({ status: 'done', winnerId, settledAt: now }).where(eq(duels.id, d.id));
      const names = new Map((await tx.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, [d.challengerId, d.opponentId]))).map((u) => [u.id, u.username]));
      const score = (id: string) => (id === d.challengerId ? `${Math.round(d.challengerTons)} : ${Math.round(d.opponentTons)} т` : `${Math.round(d.opponentTons)} : ${Math.round(d.challengerTons)} т`);
      if (winnerId) {
        await postCoins(tx, winnerId, { amount: DUEL.coins, reason: 'duel', description: `Дуел срещу ${names.get(winnerId === d.challengerId ? d.opponentId : d.challengerId)}`, idempotencyKey: `duel:${d.id}` });
        await tx.insert(userBadges).values({ userId: winnerId, badge: DUEL.badge, awardedAt: now }).onConflictDoNothing();
      }
      for (const id of [d.challengerId, d.opponentId]) {
        const rival = names.get(id === d.challengerId ? d.opponentId : d.challengerId);
        const text = !winnerId ? `Равенство (${score(id)}).` : winnerId === id ? `Победа ${score(id)}! +${DUEL.coins} ТрансКоин.` : `Загуба ${score(id)}. Реванш?`;
        await notify(tx, id, winnerId === id ? 'success' : 'info', `Дуелът с ${rival} приключи`, text, '/game/duels');
      }
    });
  }
  return due.length;
}

/** The player's duels: open ones and the last finished. */
export async function duelsOf(db: DbOrTx, userId: string, limit = 8) {
  const rows = await db.select().from(duels).where(or(eq(duels.challengerId, userId), eq(duels.opponentId, userId))).orderBy(sql`case when ${duels.status} in ('pending', 'active') then 0 else 1 end`, sql`${duels.createdAt} desc`).limit(limit);
  const ids = [...new Set(rows.flatMap((d) => [d.challengerId, d.opponentId]))];
  const names = new Map(ids.length ? (await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.username]) : []);
  return rows.map((d) => {
    const mine = d.challengerId === userId;
    return { id: d.id, status: d.status, incoming: !mine && d.status === 'pending', rival: names.get(mine ? d.opponentId : d.challengerId) ?? '—', myTons: mine ? d.challengerTons : d.opponentTons, theirTons: mine ? d.opponentTons : d.challengerTons, endsAt: d.endsAt, createdAt: d.createdAt, won: d.status === 'done' ? (d.winnerId === null ? null : d.winnerId === userId) : null };
  });
}

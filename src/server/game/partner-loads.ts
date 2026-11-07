/**
 * 1.2.6 „На една вълна“: partner loads — a relay whose second leg is kept for a
 * partner the first driver agrees with, by an invitation in private messages or
 * a „Търся партньор“ line in the global chat.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { PARTNER } from '@/lib/game/partner-loads';
import { BADGES } from '@/lib/game/halloween';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, contracts, jobState, relays, userBadges, users } from '@/server/db/schema';
import { postGameLine } from './chat-life';
import { fail } from './errors';
import { sendDirectMessage } from './messages';
import { notify } from './notify';
import { addPassPoints } from './season-pass';
import { t } from '@/i18n/t';

const href = (id: string) => `/game/contracts?partner=${id}`;

async function cityNames(db: DbOrTx, ids: number[]) {
  const rows = await db.select({ id: cities.id, nameBg: cities.nameBg }).from(cities).where(inArray(cities.id, ids));
  return (id: number) => rows.find((c) => c.id === id)?.nameBg ?? '';
}

/** The leader's partner load (must be theirs and still waiting for its second leg). */
async function ownLoad(db: DbOrTx, userId: string, relayId: string) {
  const [r] = await db.select().from(relays).where(and(eq(relays.id, relayId), eq(relays.partner, true)));
  if (!r || r.leaderId !== userId) fail('not_your_load', t('Това не е твой партньорски товар.'), 404);
  if (!['leg1', 'leg2'].includes(r!.status)) fail('load_over', t('Този партньорски товар вече приключи.'));
  if (r!.partnerId) fail('has_partner', t('Вече имаш партньор за този товар.'));
  return r!;
}

/** acceptContract: the second leg of a partner load goes only to the agreed partner. */
export async function checkPartnerLeg(db: DbOrTx, userId: string, relayId: string) {
  const [r] = await db.select({ partner: relays.partner, partnerId: relays.partnerId, leaderId: relays.leaderId }).from(relays).where(eq(relays.id, relayId));
  if (!r?.partner) return;
  if (r.leaderId === userId) fail('partner_leg', t('Втората част е за партньора ти — покани някого от „Моите партньорски товари“.'));
  if (r.partnerId && r.partnerId !== userId) fail('partner_leg', t('Тази част е запазена за партньора на шофьора.'), 409);
  if (!r.partnerId) fail('partner_leg', t('Първо стани партньор на шофьора — бутонът е в чата или в поканата.'));
}

/** The leader invites a player by name: a private message with the link, the leg is kept for them. */
export async function invitePartner(db: Database, userId: string, relayId: string, username: string, now = new Date()) {
  const r = await ownLoad(db, userId, relayId);
  const [to] = await db.select({ id: users.id, username: users.username }).from(users).where(and(sql`lower(${users.username}) = lower(${username.trim()})`, isNull(users.bannedAt)));
  if (!to) fail('player_not_found', t('Играчът не е намерен.'), 404);
  if (to!.id === userId) fail('self', t('Не можеш да си партньор на себе си.'));
  const name = await cityNames(db, [r.relayCityId, r.destCityId]);
  const [set] = await db.update(relays).set({ partnerId: to!.id }).where(and(eq(relays.id, r.id), isNull(relays.partnerId))).returning({ id: relays.id });
  if (!set) fail('has_partner', t('Вече имаш партньор за този товар.'));
  await sendDirectMessage(db, userId, to!.id, t('🤝 Ще караш ли с мен? Карам до {0}, ти поемаш до {1} — и двамата получаваме бонус. {2}', name(r.relayCityId), name(r.destCityId), href(r.id)), now);
  await db.transaction((tx) => notify(tx, to!.id, 'info', () => t('🤝 Покана за партньорски товар'), () => t('{0} до {1}: втората част е запазена за теб.', name(r.relayCityId), name(r.destCityId)), href(r.id)));
  return { partner: to!.username };
}

/** The leader looks for a partner in the global chat: a line with a „Стани партньор“ button (once per load). */
export async function askPartner(db: Database, user: { id: string; username: string }, relayId: string, now = new Date()) {
  const r = await ownLoad(db, user.id, relayId);
  if (r.askedAt) fail('asked', t('Вече потърси партньор в чата за този товар.'));
  const name = await cityNames(db, [r.originCityId, r.relayCityId, r.destCityId]);
  return db.transaction(async (tx) => {
    await tx.update(relays).set({ askedAt: now }).where(eq(relays.id, r.id));
    const id = await postGameLine(tx, 'global', 'partner', t('🤝 {0} търси партньор: {1} → {2} → {3}. Втората част е от {2} — бонус за двамата.', user.username, name(r.originCityId), name(r.relayCityId), name(r.destCityId)), { href: href(r.id), button: t('Стани партньор') }, now);
    return { messageId: id };
  });
}

/** A player answers the chat line: the first one becomes the partner. */
export async function acceptPartner(db: Database, user: { id: string; username: string }, relayId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(relays).where(and(eq(relays.id, relayId), eq(relays.partner, true))).for('update');
    if (!r || !['leg1', 'leg2'].includes(r.status) || !r.leaderId) fail('load_over', t('Този партньорски товар вече приключи.'));
    if (r!.leaderId === user.id) fail('self', t('Не можеш да си партньор на себе си.'));
    if (r!.partnerId === user.id) return { already: true };
    if (r!.partnerId) fail('has_partner', t('Някой вече стана партньор за този товар.'), 409);
    await tx.update(relays).set({ partnerId: user.id }).where(eq(relays.id, r!.id));
    const name = await cityNames(tx, [r!.relayCityId]);
    await notify(tx, r!.leaderId!, 'success', () => t('🤝 {0} е твоят партньор', user.username), () => t('Втората част от {0} е запазена за него.', name(r!.relayCityId)), href(r!.id));
    void now;
    return { already: false };
  });
}

/** Partner loads of a player: the ones they lead and the ones kept for them. */
export async function myPartnerLoads(db: DbOrTx, userId: string) {
  const rows = await db
    .select()
    .from(relays)
    .where(and(eq(relays.partner, true), inArray(relays.status, ['leg1', 'leg2']), sql`(${relays.leaderId} = ${userId} or ${relays.partnerId} = ${userId})`));
  if (!rows.length) return [];
  const ids = [...new Set(rows.flatMap((r) => [r.leaderId, r.partnerId]).filter(Boolean) as string[])];
  const people = await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, ids));
  const who = (id: string | null) => people.find((p) => p.id === id)?.username ?? null;
  const name = await cityNames(db, rows.flatMap((r) => [r.originCityId, r.relayCityId, r.destCityId]));
  const legs = await db.select({ id: contracts.id, goods: contracts.goods, status: contracts.status, expiresAt: contracts.expiresAt }).from(contracts).where(inArray(contracts.id, rows.map((r) => r.leg2ContractId)));
  return rows.map((r) => {
    const leg2 = legs.find((l) => l.id === r.leg2ContractId);
    return {
      id: r.id,
      lead: r.leaderId === userId,
      status: r.status,
      route: [name(r.originCityId), name(r.relayCityId), name(r.destCityId)] as [string, string, string],
      relayCityId: r.relayCityId,
      goods: leg2?.goods ?? '',
      leader: who(r.leaderId),
      partner: who(r.partnerId),
      asked: !!r.askedAt,
      leg2Open: leg2?.status === 'open',
      leg2ContractId: r.leg2ContractId,
      leg2Until: r.status === 'leg2' ? (leg2?.expiresAt ?? null) : null,
    };
  });
}

/** One partner load for the ?partner= card (anyone may look; the button depends on the viewer). */
export async function partnerLoadCard(db: DbOrTx, viewerId: string, relayId: string) {
  const [r] = await db.select().from(relays).where(and(eq(relays.id, relayId), eq(relays.partner, true)));
  if (!r) return null;
  const people = await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, [r.leaderId, r.partnerId].filter(Boolean) as string[]));
  const who = (id: string | null) => people.find((p) => p.id === id)?.username ?? null;
  const name = await cityNames(db, [r.originCityId, r.relayCityId, r.destCityId]);
  const open = ['leg1', 'leg2'].includes(r.status) && !!r.leaderId;
  return {
    id: r.id,
    route: [name(r.originCityId), name(r.relayCityId), name(r.destCityId)] as [string, string, string],
    relayCityId: r.relayCityId,
    status: r.status,
    leader: who(r.leaderId),
    partner: who(r.partnerId),
    mine: r.partnerId === viewerId,
    lead: r.leaderId === viewerId,
    canJoin: open && !r.partnerId && r.leaderId !== viewerId,
  };
}

/** relayDelivered: the hand-over of a partner load tells the partner their leg is ready. */
export async function partnerHandover(tx: Tx, r: { id: string; partnerId: string | null; relayCityId: number }, goods: string) {
  if (!r.partnerId) return;
  const name = await cityNames(tx, [r.relayCityId]);
  await notify(tx, r.partnerId, 'success', () => t('🤝 Твоят ред е: „{0}“ чака в {1}', goods, name(r.relayCityId)), () => t('Поеми втората част до {0} ч — бонус и за двамата.', PARTNER.handoverHours), `/game/contracts?from=${r.relayCityId}`);
}

/**
 * relayDelivered: both on time with the agreed partner — pass points for both and the count
 * of loads together; the third one makes them trusted partners (a badge for both).
 */
export async function partnersArrived(tx: Tx, leaderId: string, partnerId: string, at: Date) {
  const [a, b] = [leaderId, partnerId].sort();
  const [row] = await tx
    .insert(jobState)
    .values({ key: `partners:${a}:${b}`, value: { n: 1 }, updatedAt: at })
    .onConflictDoUpdate({ target: jobState.key, set: { value: sql`jsonb_build_object('n', coalesce((${jobState.value}->>'n')::int, 0) + 1)`, updatedAt: at } })
    .returning({ value: jobState.value });
  const n = Number((row!.value as { n: number }).n);
  for (const u of [leaderId, partnerId]) {
    await addPassPoints(tx, u, PARTNER.passPoints, at);
    if (n >= PARTNER.trustedAfter) {
      const [got] = await tx.insert(userBadges).values({ userId: u, badge: PARTNER.badge, awardedAt: at }).onConflictDoNothing().returning();
      if (got) await notify(tx, u, 'achievement', () => t('Значка: {0}', BADGES[PARTNER.badge]?.label ?? ''), BADGES[PARTNER.badge]?.description ?? '', '/game/contracts');
    }
  }
  return n;
}

/** How many partner loads two players finished together. */
export async function loadsTogether(db: DbOrTx, x: string, y: string) {
  const [a, b] = [x, y].sort();
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, `partners:${a}:${b}`));
  return Number((row?.value as { n?: number } | undefined)?.n ?? 0);
}

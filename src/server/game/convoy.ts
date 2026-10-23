import { and, asc, desc, eq, gt, gte, inArray, isNull, ne } from 'drizzle-orm';
import { featureFor } from '@/server/features';
import { CONVOY_RULES } from '@/lib/game/convoy';
import type { DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, contracts, deliveries, discordVoice, openConvoys, users } from '@/server/db/schema';
import { enqueue } from '@/server/discord/outbox';
import { companyForUser } from './company';
import { fail } from './errors';
import { layoutState } from '@/server/discord/layout';
import { notify } from './notify';
import { alliesOf, circleOf } from './world-map';

/**
 * Linked players who are in the Discord voice channel "Конвой" together with
 * this player right now (v1.3): they count as a convoy like friends do.
 */
async function voiceMates(db: DbOrTx, userId: string, now: Date) {
  if (!(await featureFor(db, userId, 'discord_bot', now))) return [];
  const [me] = await db.select({ discordId: users.discordId }).from(users).where(eq(users.id, userId));
  if (!me?.discordId) return [];
  const convoyChannel = (await layoutState(db)).channels['конвой'];
  if (!convoyChannel) return [];
  const [inside] = await db.select({ id: discordVoice.discordUserId }).from(discordVoice).where(and(eq(discordVoice.discordUserId, me.discordId), eq(discordVoice.channelId, convoyChannel)));
  if (!inside) return [];
  const rows = await db.select({ id: users.id }).from(discordVoice).innerJoin(users, eq(users.discordId, discordVoice.discordUserId)).where(and(eq(discordVoice.channelId, convoyChannel), ne(users.id, userId)));
  return rows.map((r) => r.id);
}

/** Players who announced a convoy in Discord (/конвой) that is still open: anyone may join them. */
async function openConvoyHosts(db: DbOrTx, userId: string, now: Date, lane?: { originCityId: number; destCityId: number }) {
  const rows = await db
    .select({ id: openConvoys.userId })
    .from(openConvoys)
    .where(and(gt(openConvoys.expiresAt, now), ne(openConvoys.userId, userId), ...(lane ? [eq(openConvoys.originCityId, lane.originCityId), eq(openConvoys.destCityId, lane.destCityId)] : [])));
  return rows.map((r) => r.id);
}

/**
 * /конвой (Discord): the player's trip that left in the last half hour goes to
 * #конвои — whoever leaves on the same lane before the window closes drives in
 * convoy with them (the usual bonus), friends or not.
 */
export async function announceConvoy(db: DbOrTx, userId: string, now = new Date()) {
  const account = await companyForUser(db, userId);
  const [trip] = await db
    .select({ id: deliveries.id, startedAt: deliveries.startedAt, convoyWith: deliveries.convoyWith, originCityId: contracts.originCityId, destCityId: contracts.destCityId, goods: contracts.goods, urgent: contracts.urgent })
    .from(deliveries)
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .where(and(eq(deliveries.companyId, account.id), eq(deliveries.status, 'in_progress'), gte(deliveries.startedAt, new Date(now.getTime() - CONVOY_RULES.windowMs))))
    .orderBy(desc(deliveries.startedAt))
    .limit(1);
  if (!trip || trip.urgent) fail('no_trip', `Пусни камион на курс (обикновен товар) и обяви конвоя до ${Math.round(CONVOY_RULES.windowMs / 60_000)} мин. след тръгването.`);
  if (trip!.convoyWith) fail('already', 'Този камион вече кара в конвой.');
  const expiresAt = new Date(trip!.startedAt.getTime() + CONVOY_RULES.windowMs);
  const [row] = await db.insert(openConvoys).values({ deliveryId: trip!.id, userId, originCityId: trip!.originCityId, destCityId: trip!.destCityId, expiresAt, createdAt: now }).onConflictDoNothing().returning();
  if (!row) fail('already', 'Вече обяви конвой с този курс.');
  const names = await db.select({ id: cities.id, nameBg: cities.nameBg }).from(cities).where(inArray(cities.id, [trip!.originCityId, trip!.destCityId]));
  const name = (id: number) => names.find((c) => c.id === id)?.nameBg ?? '';
  const [me] = await db.select({ username: users.username, discordId: users.discordId }).from(users).where(eq(users.id, userId));
  await enqueue(db, `convoy:${row!.id}`, 'channel:convoys', {
    embeds: [{
      title: `🚚 Конвой: ${name(trip!.originCityId)} → ${name(trip!.destCityId)}`,
      color: 0x22d3ee,
      description: `**${me!.username}**${me!.discordId ? ` (<@${me!.discordId}>)` : ''} кара ${trip!.goods}. Тръгни по същия път до <t:${Math.floor(expiresAt.getTime() / 1000)}:t> и карате в конвой — **+${Math.round(CONVOY_RULES.bonusShare * 100)} %** към наградата за всеки, ако пристигнете навреме.`,
    }],
    components: [{ type: 1, components: [{ type: 2, style: 3, label: 'Включвам се', custom_id: `convoy:join:${row!.id}`, emoji: { name: '🚚' } }] }],
  }, now);
  return { ...row!, origin: name(trip!.originCityId), destination: name(trip!.destCityId) };
}

/** Friends', company members', voice convoy mates' and open convoys' trips on this lane that left recently and have no convoy yet. */
export async function convoyCandidates(db: DbOrTx, userId: string, now: Date, lane?: { originCityId: number; destCityId: number }) {
  const { friends, mates } = await circleOf(db, userId);
  // v1.5: the other companies of the alliance drive in convoy too.
  const allies = (await featureFor(db, userId, 'alliance_convoy', now)) ? await alliesOf(db, userId) : new Set<string>();
  const ids = [...new Set([...friends, ...mates, ...allies, ...(await voiceMates(db, userId, now)), ...(await openConvoyHosts(db, userId, now, lane))])];
  if (!ids.length) return [];
  return db
    .select({ deliveryId: deliveries.id, userId: users.id, username: users.username, originCityId: contracts.originCityId, destCityId: contracts.destCityId, startedAt: deliveries.startedAt })
    .from(deliveries)
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .innerJoin(users, eq(users.id, companies.ownerId))
    .where(
      and(
        inArray(users.id, ids),
        eq(deliveries.status, 'in_progress'),
        isNull(deliveries.convoyWith),
        gte(deliveries.startedAt, new Date(now.getTime() - CONVOY_RULES.windowMs)),
        ...(lane ? [eq(contracts.originCityId, lane.originCityId), eq(contracts.destCityId, lane.destCityId)] : []),
      ),
    )
    .orderBy(asc(deliveries.startedAt));
}

/** A new trip joins the earliest matching one into a convoy; both players are told. */
export async function formConvoy(tx: Tx, delivery: { id: string; companyId: string }, userId: string, lane: { originCityId: number; destCityId: number }, now: Date) {
  if (!(await featureFor(tx, userId, 'convoy', now))) return null;
  const [partner] = (await convoyCandidates(tx, userId, now, lane)).filter((c) => c.deliveryId !== delivery.id);
  if (!partner) return null;
  // Lock the partner's trip so two new trips cannot both join it.
  const [locked] = await tx.select({ id: deliveries.id }).from(deliveries).where(and(eq(deliveries.id, partner.deliveryId), isNull(deliveries.convoyWith), ne(deliveries.id, delivery.id))).for('update');
  if (!locked) return null;
  await tx.update(deliveries).set({ convoyWith: delivery.id }).where(eq(deliveries.id, partner.deliveryId));
  await tx.update(deliveries).set({ convoyWith: partner.deliveryId }).where(eq(deliveries.id, delivery.id));
  const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, userId));
  const names = await tx.select({ id: cities.id, nameBg: cities.nameBg }).from(cities).where(inArray(cities.id, [lane.originCityId, lane.destCityId]));
  const name = (id: number) => names.find((c) => c.id === id)?.nameBg ?? '';
  const bonus = `${Math.round(CONVOY_RULES.bonusShare * 100)} %`;
  const route = `${name(lane.originCityId)} → ${name(lane.destCityId)}`;
  await notify(tx, userId, 'success', `Конвой с ${partner.username}`, `${route}: карате заедно — +${bonus} към наградата за всеки, ако пристигнете навреме.`, '/game/map');
  await notify(tx, partner.userId, 'success', `Конвой с ${me!.username}`, `${me!.username} тръгна след теб по ${route}: +${bonus} към наградата за всеки, ако пристигнете навреме.`, '/game/map');
  return partner;
}

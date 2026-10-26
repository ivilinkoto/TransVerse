import { and, asc, count, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { CUPS, cupPoints, cupPrizes, type CupMetric } from '@/lib/game/community-cups';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, communityTournaments, communityCupEntries, users } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { notify } from './notify';
import { t as tr } from '@/i18n/t';

async function released(db: DbOrTx, userId: string, now: Date) {
  if (!(await featureFor(db, userId, 'community_cups', now))) fail('not_released', tr('Това идва със следващото обновление.'), 403);
}

export interface CupInput {
  name: string;
  description: string;
  metric: CupMetric;
  cargoType: string | null;
  countryCode: string | null;
  startsAt: Date;
  endsAt: Date;
  prizeCents: number;
  entryFeeCents: number;
  maxPlayers: number;
}

/** A player of level 10+ organises a tournament; the prize leaves their account until the end. */
export async function createCup(db: Database, userId: string, input: CupInput, now = new Date()) {
  await released(db, userId, now);
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (name.length < 3 || name.length > CUPS.nameMax) fail('invalid_name', tr('Името е от {0} до {1} символа.', 3, CUPS.nameMax));
  if (input.prizeCents < CUPS.minPrizeCents || input.prizeCents > CUPS.maxPrizeCents) fail('invalid_prize', tr('Наградата е между {0} и {1} лв.', CUPS.minPrizeCents / 100, CUPS.maxPrizeCents / 100));
  if (input.entryFeeCents < 0 || input.entryFeeCents > CUPS.maxFeeCents) fail('invalid_fee', tr('Таксата е до {0} лв.', CUPS.maxFeeCents / 100));
  if (input.startsAt.getTime() < now.getTime() - 60_000 || input.startsAt.getTime() > now.getTime() + CUPS.maxAheadDays * 86_400_000) fail('invalid_start', tr('Турнирът започва до {0} дни напред.', CUPS.maxAheadDays));
  const hours = (input.endsAt.getTime() - input.startsAt.getTime()) / 3_600_000;
  if (hours < CUPS.minHours || hours > CUPS.maxDays * 24) fail('invalid_length', tr('Турнирът трае от {0} ч до {1} дни.', CUPS.minHours, CUPS.maxDays));
  if (input.maxPlayers < CUPS.minPlayers || input.maxPlayers > CUPS.maxPlayers) fail('invalid_players', tr('Играчите са от {0} до {1}.', CUPS.minPlayers, CUPS.maxPlayers));
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ level: users.level }).from(users).where(eq(users.id, userId));
    if ((u?.level ?? 1) < CUPS.minLevel) fail('level', tr('Турнири организират играчи от ниво {0}.', CUPS.minLevel));
    const [{ n = 0 } = {}] = await tx.select({ n: count() }).from(communityTournaments).where(and(eq(communityTournaments.organizerId, userId), eq(communityTournaments.status, 'open')));
    if (n >= CUPS.maxOpenPerOrganizer) fail('too_many', tr('Може да организираш до {0} турнира наведнъж.', CUPS.maxOpenPerOrganizer));
    const [cup] = await tx.insert(communityTournaments).values({ organizerId: userId, name, description: input.description.trim().slice(0, CUPS.textMax), metric: input.metric, cargoType: input.cargoType, countryCode: input.countryCode, startsAt: input.startsAt, endsAt: input.endsAt, poolCents: input.prizeCents, entryFeeCents: input.entryFeeCents, maxPlayers: input.maxPlayers, createdAt: now }).returning();
    const account = await companyForUser(tx, userId);
    await post(tx, account.id, [{ category: 'tournament', amountCents: -input.prizeCents, description: tr('Награда за турнира „{0}“', name), idempotencyKey: `cup:${cup!.id}:prize` }], { requireFunds: true });
    return cup!;
  });
}

/** A player joins before the end; the entry fee goes into the prize. */
export async function joinCommunityCup(db: Database, userId: string, cupId: string, now = new Date()) {
  await released(db, userId, now);
  return db.transaction(async (tx) => {
    const [cup] = await tx.select().from(communityTournaments).where(eq(communityTournaments.id, cupId)).for('update');
    if (!cup || cup.status !== 'open' || cup.endsAt <= now) fail('closed', tr('Турнирът не приема участници.'), 404);
    const [{ n = 0 } = {}] = await tx.select({ n: count() }).from(communityCupEntries).where(eq(communityCupEntries.tournamentId, cupId));
    if (n >= cup!.maxPlayers) fail('full', tr('Турнирът е пълен.'));
    const [row] = await tx.insert(communityCupEntries).values({ tournamentId: cupId, userId, joinedAt: now }).onConflictDoNothing().returning();
    if (!row) fail('already', tr('Вече участваш.'));
    if (cup!.entryFeeCents > 0) {
      const account = await companyForUser(tx, userId);
      await post(tx, account.id, [{ category: 'tournament', amountCents: -cup!.entryFeeCents, description: tr('Такса за турнира „{0}“', cup!.name), idempotencyKey: `cup:${cupId}:fee:${userId}` }], { requireFunds: true });
      await tx.update(communityTournaments).set({ poolCents: sql`${communityTournaments.poolCents} + ${cup!.entryFeeCents}` }).where(eq(communityTournaments.id, cupId));
    }
    return row!;
  });
}

/** The organiser removes a player; the fee comes back to them. */
export async function removeFromCup(db: Database, organizerId: string, cupId: string, userId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const cup = await organizerCup(tx, organizerId, cupId);
    const [gone] = await tx.delete(communityCupEntries).where(and(eq(communityCupEntries.tournamentId, cupId), eq(communityCupEntries.userId, userId))).returning();
    if (!gone) fail('not_found', tr('Този играч не участва.'), 404);
    await refundFee(tx, cup, userId);
    await notify(tx, userId, 'info', () => tr('Извадиха те от турнира „{0}“', cup.name), () => (cup.entryFeeCents ? tr('Таксата ти е върната.') : tr('Организаторът те извади от турнира.')), '/game/cups');
    void now;
  });
}

/** The organiser's message to every player. */
export async function announceCup(db: Database, organizerId: string, cupId: string, text: string) {
  return db.transaction(async (tx) => {
    const cup = await organizerCup(tx, organizerId, cupId);
    const message = text.trim().slice(0, CUPS.textMax);
    await tx.update(communityTournaments).set({ announcement: message || null }).where(eq(communityTournaments.id, cupId));
    if (!message) return;
    const players = await tx.select({ userId: communityCupEntries.userId }).from(communityCupEntries).where(eq(communityCupEntries.tournamentId, cupId));
    for (const p of players) await notify(tx, p.userId, 'info', () => tr('Турнир „{0}“', cup.name), () => message, `/game/cups/${cupId}`);
  });
}

/** Before the start the organiser may cancel: the prize and every fee come back. */
export async function cancelCup(db: Database, organizerId: string, cupId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const cup = await organizerCup(tx, organizerId, cupId);
    if (cup.startsAt <= now) fail('started', tr('Започнал турнир не може да се отмени.'));
    const players = await tx.select({ userId: communityCupEntries.userId }).from(communityCupEntries).where(eq(communityCupEntries.tournamentId, cupId));
    for (const p of players) await refundFee(tx, cup, p.userId);
    const account = await companyForUser(tx, organizerId);
    await post(tx, account.id, [{ category: 'tournament', amountCents: cup.poolCents - cup.entryFeeCents * players.length, description: tr('Отменен турнир „{0}“', cup.name), idempotencyKey: `cup:${cupId}:cancel` }]);
    await tx.update(communityTournaments).set({ status: 'cancelled', poolCents: 0 }).where(eq(communityTournaments.id, cupId));
  });
}

async function organizerCup(tx: Tx, organizerId: string, cupId: string) {
  const [cup] = await tx.select().from(communityTournaments).where(eq(communityTournaments.id, cupId)).for('update');
  if (!cup || cup.status !== 'open') fail('not_found', tr('Турнирът не е намерен.'), 404);
  if (cup!.organizerId !== organizerId) fail('forbidden', tr('Само организаторът може това.'), 403);
  return cup!;
}

async function refundFee(tx: Tx, cup: typeof communityTournaments.$inferSelect, userId: string) {
  if (!cup.entryFeeCents) return;
  const account = await companyForUser(tx, userId);
  await post(tx, account.id, [{ category: 'tournament', amountCents: cup.entryFeeCents, description: tr('Върната такса: турнир „{0}“', cup.name), idempotencyKey: `cup:${cup.id}:refund:${userId}` }]);
  await tx.update(communityTournaments).set({ poolCents: sql`${communityTournaments.poolCents} - ${cup.entryFeeCents}` }).where(eq(communityTournaments.id, cup.id));
}

/** A player's load arrived: it counts in every running tournament of theirs it fits. */
export async function recordCupDelivery(tx: Tx, userId: string, load: { destCityId: number; cargoType: string; tons: number; km: number; late: boolean }, at: Date) {
  const running = await tx
    .select({ id: communityTournaments.id, metric: communityTournaments.metric, cargoType: communityTournaments.cargoType, countryCode: communityTournaments.countryCode })
    .from(communityCupEntries)
    .innerJoin(communityTournaments, eq(communityTournaments.id, communityCupEntries.tournamentId))
    .where(and(eq(communityCupEntries.userId, userId), eq(communityTournaments.status, 'open'), lte(communityTournaments.startsAt, at), gt(communityTournaments.endsAt, at)));
  if (!running.length) return;
  const [dest] = running.some((r) => r.countryCode) ? await tx.select({ country: cities.countryCode }).from(cities).where(eq(cities.id, load.destCityId)) : [];
  for (const r of running) {
    if (r.cargoType && r.cargoType !== load.cargoType) continue;
    if (r.countryCode && r.countryCode !== dest?.country) continue;
    const points = cupPoints(r.metric as CupMetric, load);
    if (points > 0) await tx.update(communityCupEntries).set({ score: sql`${communityCupEntries.score} + ${points}` }).where(and(eq(communityCupEntries.tournamentId, r.id), eq(communityCupEntries.userId, userId)));
  }
}

/** Worker: finished tournaments pay the first three (no players: the prize goes back to the organiser). */
export async function settleCups(db: Database, now = new Date()) {
  const due = await db.select().from(communityTournaments).where(and(eq(communityTournaments.status, 'open'), lte(communityTournaments.endsAt, now))).limit(20);
  let settled = 0;
  for (const cup of due) {
    await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(communityTournaments).where(eq(communityTournaments.id, cup.id)).for('update');
      if (!locked || locked.status !== 'open') return;
      const top = await tx.select({ userId: communityCupEntries.userId, score: communityCupEntries.score }).from(communityCupEntries).where(and(eq(communityCupEntries.tournamentId, cup.id), gt(communityCupEntries.score, 0))).orderBy(desc(communityCupEntries.score), asc(communityCupEntries.joinedAt)).limit(3);
      if (!top.length) {
        const account = await companyForUser(tx, cup.organizerId);
        await post(tx, account.id, [{ category: 'tournament', amountCents: locked.poolCents, description: tr('Турнир без резултати: „{0}“', cup.name), idempotencyKey: `cup:${cup.id}:back` }]);
      } else {
        const prizes = cupPrizes(locked.poolCents, top.length);
        for (const [i, w] of top.entries()) {
          const account = await companyForUser(tx, w.userId);
          await post(tx, account.id, [{ category: 'tournament', amountCents: prizes[i]!, description: tr('{0} място в турнира „{1}“', i + 1, cup.name), idempotencyKey: `cup:${cup.id}:prize:${i + 1}` }]);
          await notify(tx, w.userId, 'achievement', () => tr('{0} място в турнира „{1}“!', i + 1, cup.name), () => tr('Наградата е в сметката ти.'), `/game/cups/${cup.id}`);
        }
      }
      await tx.update(communityTournaments).set({ status: 'done' }).where(eq(communityTournaments.id, cup.id));
      settled++;
    });
  }
  return settled;
}

/** The tournaments to show: open ones first (by start), then the latest finished. */
export async function cupsList(db: DbOrTx, limit = 40) {
  const rows = await db
    .select({ cup: communityTournaments, organizer: users.username, players: sql<number>`(select count(*) from ${communityCupEntries} e where e.tournament_id = ${communityTournaments.id})::int` })
    .from(communityTournaments)
    .innerJoin(users, eq(users.id, communityTournaments.organizerId))
    .where(inArray(communityTournaments.status, ['open', 'done']))
    .orderBy(sql`${communityTournaments.status} = 'done'`, asc(communityTournaments.startsAt))
    .limit(limit);
  return rows;
}

/** One tournament with its ranking. */
export async function cupView(db: DbOrTx, cupId: string) {
  const [row] = await db.select({ cup: communityTournaments, organizer: users.username }).from(communityTournaments).innerJoin(users, eq(users.id, communityTournaments.organizerId)).where(eq(communityTournaments.id, cupId));
  if (!row) return null;
  const ranking = await db.select({ userId: communityCupEntries.userId, username: users.username, score: communityCupEntries.score }).from(communityCupEntries).innerJoin(users, eq(users.id, communityCupEntries.userId)).where(eq(communityCupEntries.tournamentId, cupId)).orderBy(desc(communityCupEntries.score), asc(communityCupEntries.joinedAt));
  return { ...row, ranking };
}

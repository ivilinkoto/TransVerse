/**
 * „Просто“ (14 November 2026): what players had in the deleted features comes back to them,
 * once (the features themselves are deleted). Every payment has its own
 * idempotency key, so a second run pays nothing twice. Money through post(), ТрансКоин through
 * postCoins(). Silent: no notification, no release notes (only the entry in the player's finances).
 * - Акции: each holding back at the higher of what it cost and what it is worth now.
 * - Редки номера: the leading bid of an open auction.
 * - Застрахователи: the premium of a policy still running.
 * - Турнири на общността: entry fees to the players, the rest of the prize to the organiser.
 * - Предизвикателства от играчи: the prize to its creator.
 * - Ремаркета под наем: hired trailers go back to their owners (one on a trip after the trip),
 *   the renter gets the unused days back; open offers are withdrawn.
 * - Автостоп: a passenger already aboard pays the whole fare now; those still waiting are gone.
 */
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Database, Tx } from '@/server/db/client';
import { communityCupEntries, communityTournaments, deliveries, hitchhikers, insurancePolicies, jobState, organizations, plateAuctions, playerChallenges, shareHoldings, trailerHires, trailers, vehicles } from '@/server/db/schema';
import { t } from '@/i18n/t';
import { companyForUser } from './company';
import { postCoins } from './coins';
import { post } from './finance';

const DONE = 'retired-2026-11-14';
const DAY = 86_400_000;

/** The money of the removed features back to the players (once). Returns what was settled, or null when already done. */
export async function settleRetired(db: Database, now = new Date()) {
  const [done] = await db.select({ key: jobState.key }).from(jobState).where(eq(jobState.key, DONE));
  if (done) return null;
  const out = { shares: 0, bids: 0, policies: 0, cups: 0, challenges: 0, offers: 0, riders: 0 };

  // Акции.
  const holdings = await db.select({ orgId: shareHoldings.organizationId, userId: shareHoldings.userId, shares: shareHoldings.shares, costCents: shareHoldings.costCents, priceCents: organizations.sharePriceCents, name: organizations.name }).from(shareHoldings).innerJoin(organizations, eq(organizations.id, shareHoldings.organizationId));
  for (const h of holdings) {
    await db.transaction(async (tx) => {
      const back = Math.max(Number(h.costCents), h.shares * Number(h.priceCents));
      const account = await companyForUser(tx, h.userId);
      if (back > 0) await post(tx, account.id, [{ category: 'share_trade', amountCents: back, description: t('Борсата за акции е закрита: {0} акции на {1}', h.shares, h.name), idempotencyKey: `retired:shares:${h.orgId}:${h.userId}` }]);
      await tx.delete(shareHoldings).where(and(eq(shareHoldings.organizationId, h.orgId), eq(shareHoldings.userId, h.userId)));
    });
    out.shares++;
  }

  // Редки номера.
  for (const a of await db.select().from(plateAuctions).where(isNull(plateAuctions.settledAt))) {
    await db.transaction(async (tx) => {
      if (a.bidUserId && a.bidCoins) {
        await postCoins(tx, a.bidUserId, { amount: a.bidCoins, reason: 'plate_auction', description: t('Търгът за номер „{0}“ е закрит — офертата ти е върната', a.plate), idempotencyKey: `retired:plate:${a.weekKey}` });
        out.bids++;
      }
      await tx.update(plateAuctions).set({ settledAt: now, bidUserId: null }).where(eq(plateAuctions.weekKey, a.weekKey));
    });
  }

  // Застрахователи.
  for (const p of await db.select().from(insurancePolicies).where(gt(insurancePolicies.endsAt, now))) {
    await db.transaction(async (tx) => {
      await post(tx, p.companyId, [{ category: 'insurance_premium', amountCents: Number(p.premiumCents), description: t('Застрахователите са закрити — премията е върната'), idempotencyKey: `retired:policy:${p.id}` }]);
      await tx.update(insurancePolicies).set({ endsAt: now }).where(eq(insurancePolicies.id, p.id));
    });
    out.policies++;
  }

  // Турнири на общността.
  for (const cup of await db.select().from(communityTournaments).where(eq(communityTournaments.status, 'open'))) {
    await db.transaction(async (tx) => {
      const players = await tx.select({ userId: communityCupEntries.userId }).from(communityCupEntries).where(eq(communityCupEntries.tournamentId, cup.id));
      let fees = 0;
      if (cup.entryFeeCents) {
        for (const p of players) {
          const account = await companyForUser(tx, p.userId);
          await post(tx, account.id, [{ category: 'tournament', amountCents: Number(cup.entryFeeCents), description: t('Върната такса: турнир „{0}“', cup.name), idempotencyKey: `retired:cup:${cup.id}:${p.userId}` }]);
          fees += Number(cup.entryFeeCents);
        }
      }
      const rest = Number(cup.poolCents) - fees;
      if (rest > 0) {
        const account = await companyForUser(tx, cup.organizerId);
        await post(tx, account.id, [{ category: 'tournament', amountCents: rest, description: t('Турнирите на общността са закрити: „{0}“', cup.name), idempotencyKey: `retired:cup:${cup.id}:organizer` }]);
      }
      await tx.update(communityTournaments).set({ status: 'cancelled', poolCents: 0 }).where(eq(communityTournaments.id, cup.id));
    });
    out.cups++;
  }

  // Предизвикателства от играчи.
  for (const c of await db.select().from(playerChallenges).where(eq(playerChallenges.status, 'open'))) {
    await db.transaction(async (tx) => {
      const account = await companyForUser(tx, c.creatorId);
      await post(tx, account.id, [{ category: 'player_challenge', amountCents: Number(c.prizeCents), description: t('Върната награда: „{0}“', c.title), idempotencyKey: `retired:challenge:${c.id}` }]);
      await tx.update(playerChallenges).set({ status: 'settled', winnerId: null }).where(eq(playerChallenges.id, c.id));
    });
    out.challenges++;
  }

  // Ремаркета под наем: the unused days of running hires; offers nobody took are withdrawn.
  for (const h of await db.select().from(trailerHires).where(isNull(trailerHires.endedAt))) {
    await db.transaction(async (tx) => {
      if (!h.renterId) {
        await tx.update(trailers).set({ hiredOut: false }).where(eq(trailers.id, h.trailerId));
        await tx.update(trailerHires).set({ endedAt: now }).where(eq(trailerHires.id, h.id));
        out.offers++;
        return;
      }
      const days = h.until ? Math.floor((h.until.getTime() - now.getTime()) / DAY) : 0;
      if (days > 0) {
        const account = await companyForUser(tx, h.renterId);
        await post(tx, account.id, [{ category: 'trailer_hire', amountCents: days * Number(h.pricePerDayCents), description: t('Наемът на ремаркета е закрит — {0} неизползвани дни', days), idempotencyKey: `retired:hire:${h.id}` }]);
      }
    });
  }
  // Автостоп (the same key as on arrival, so nobody is paid twice).
  for (const h of await db.select({ id: hitchhikers.id, status: hitchhikers.status, fareCents: hitchhikers.fareCents, deliveryId: hitchhikers.deliveryId, companyId: deliveries.companyId }).from(hitchhikers).innerJoin(deliveries, eq(deliveries.id, hitchhikers.deliveryId)).where(isNull(hitchhikers.settledAt))) {
    await db.transaction(async (tx) => {
      if (h.status === 'aboard') {
        await post(tx, h.companyId, [{ category: 'hitchhiker', amountCents: h.fareCents, description: t('Автостоп'), idempotencyKey: `hitchhiker:${h.id}`, refType: 'delivery', refId: h.deliveryId }]);
        out.riders++;
      }
      await tx.update(hitchhikers).set({ status: h.status === 'aboard' ? 'done' : 'missed', settledAt: now }).where(eq(hitchhikers.id, h.id));
    });
  }
  await db.insert(jobState).values({ key: DONE, value: { at: now.toISOString(), ...out } }).onConflictDoNothing();
  return out;
}

/** Worker, every run: hired trailers go back to their owners (one on a trip once the trip is over). */
export async function returnRetiredHires(db: Database, now = new Date()) {
  const open = await db.select({ id: trailerHires.id }).from(trailerHires).where(isNull(trailerHires.endedAt));
  let n = 0;
  for (const h of open) if (await db.transaction((tx) => giveBack(tx, h.id, now))) n++;
  return n;
}

/** A hired trailer back to its owner (the renter's copy goes); not while it is on a trip. */
async function giveBack(tx: Tx, hireId: string, now: Date) {
  const [h] = await tx.select().from(trailerHires).where(and(eq(trailerHires.id, hireId), isNull(trailerHires.endedAt))).for('update');
  if (!h) return false;
  if (h.hiredTrailerId) {
    const [copy] = await tx.select().from(trailers).where(eq(trailers.id, h.hiredTrailerId)).for('update');
    if (copy?.vehicleId) {
      const [v] = await tx.select({ status: vehicles.status }).from(vehicles).where(eq(vehicles.id, copy.vehicleId));
      if (v?.status === 'on_delivery') return false;
    }
    if (copy) await tx.update(trailers).set({ vehicleId: null, soldAt: now }).where(eq(trailers.id, copy.id));
    await tx.update(trailers).set({ hiredOut: false, ...(copy ? { cityId: copy.cityId, condition: copy.condition } : {}) }).where(eq(trailers.id, h.trailerId));
  } else {
    await tx.update(trailers).set({ hiredOut: false }).where(eq(trailers.id, h.trailerId));
  }
  await tx.update(trailerHires).set({ endedAt: now }).where(eq(trailerHires.id, h.id));
  return true;
}

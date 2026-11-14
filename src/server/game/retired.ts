/**
 * „Просто“ (14 November 2026): what players had in the removed features comes back to them,
 * once, before the features stop (RETIRED in features.ts). Every payment has its own
 * idempotency key, so a second run pays nothing twice. Money through post(), ТрансКоин through
 * postCoins(); each player is told.
 * - Акции: each holding back at the higher of what it cost and what it is worth now.
 * - Редки номера: the leading bid of an open auction.
 * - Застрахователи: the premium of a policy still running.
 * - Турнири на общността: entry fees to the players, the rest of the prize to the organiser.
 * - Предизвикателства от играчи: the prize to its creator.
 * - Ремаркета под наем: hired trailers go back to their owners (one on a trip after the trip),
 *   the renter gets the unused days back; open offers are withdrawn.
 */
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Database } from '@/server/db/client';
import { communityCupEntries, communityTournaments, insurancePolicies, jobState, organizations, plateAuctions, playerChallenges, shareHoldings, trailerHires, trailers } from '@/server/db/schema';
import { money } from '@/lib/format';
import { t } from '@/i18n/t';
import { companyForUser } from './company';
import { postCoins } from './coins';
import { post } from './finance';
import { notify } from './notify';
import { giveBack } from './trailer-hire';

const DONE = 'retired-2026-11-14';
const DAY = 86_400_000;

/** The money of the removed features back to the players (once). Returns what was settled, or null when already done. */
export async function settleRetired(db: Database, now = new Date()) {
  const [done] = await db.select({ key: jobState.key }).from(jobState).where(eq(jobState.key, DONE));
  if (done) return null;
  const out = { shares: 0, bids: 0, policies: 0, cups: 0, challenges: 0, offers: 0 };

  // Акции.
  const holdings = await db.select({ orgId: shareHoldings.organizationId, userId: shareHoldings.userId, shares: shareHoldings.shares, costCents: shareHoldings.costCents, priceCents: organizations.sharePriceCents, name: organizations.name }).from(shareHoldings).innerJoin(organizations, eq(organizations.id, shareHoldings.organizationId));
  for (const h of holdings) {
    await db.transaction(async (tx) => {
      const back = Math.max(Number(h.costCents), h.shares * Number(h.priceCents));
      const account = await companyForUser(tx, h.userId);
      if (back > 0) await post(tx, account.id, [{ category: 'share_trade', amountCents: back, description: t('Борсата за акции е закрита: {0} акции на {1}', h.shares, h.name), idempotencyKey: `retired:shares:${h.orgId}:${h.userId}` }]);
      await tx.delete(shareHoldings).where(and(eq(shareHoldings.organizationId, h.orgId), eq(shareHoldings.userId, h.userId)));
      await notify(tx, h.userId, 'info', () => t('Борсата за акции е закрита'), () => t('Акциите ти са изкупени: {0} са в сметката ти.', money(back)), '/game/finance');
    });
    out.shares++;
  }

  // Редки номера.
  for (const a of await db.select().from(plateAuctions).where(isNull(plateAuctions.settledAt))) {
    await db.transaction(async (tx) => {
      if (a.bidUserId && a.bidCoins) {
        await postCoins(tx, a.bidUserId, { amount: a.bidCoins, reason: 'plate_auction', description: t('Търгът за номер „{0}“ е закрит — офертата ти е върната', a.plate), idempotencyKey: `retired:plate:${a.weekKey}` });
        await notify(tx, a.bidUserId, 'info', () => t('Търгът за номера е закрит'), () => t('Офертата ти от {0} TC е върната.', a.bidCoins), '/game/shop');
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
      await notify(tx, p.userId, 'info', () => t('Застраховката е прекратена'), () => t('Застрахователите са закрити. Премията от {0} е върната.', money(Number(p.premiumCents))), '/game/finance');
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
      for (const uid of new Set([cup.organizerId, ...players.map((p) => p.userId)])) await notify(tx, uid, 'info', () => t('Турнирът „{0}“ е отменен', cup.name), () => t('Турнирите на общността са закрити. Таксите и наградата са върнати.'), '/game/finance');
    });
    out.cups++;
  }

  // Предизвикателства от играчи.
  for (const c of await db.select().from(playerChallenges).where(eq(playerChallenges.status, 'open'))) {
    await db.transaction(async (tx) => {
      const account = await companyForUser(tx, c.creatorId);
      await post(tx, account.id, [{ category: 'player_challenge', amountCents: Number(c.prizeCents), description: t('Върната награда: „{0}“', c.title), idempotencyKey: `retired:challenge:${c.id}` }]);
      await tx.update(playerChallenges).set({ status: 'settled', winnerId: null }).where(eq(playerChallenges.id, c.id));
      await notify(tx, c.creatorId, 'info', () => t('Предизвикателството „{0}“ е отменено', c.title), () => t('Предизвикателствата от играчи са закрити. Наградата от {0} е върната.', money(Number(c.prizeCents))), '/game/finance');
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

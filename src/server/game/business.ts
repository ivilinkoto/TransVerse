import { and, asc, count, eq, gt, lte, sql } from 'drizzle-orm';
import { BRANCH, branchSlots, creditRating, creditTier, LOAN, loanTerms } from '@/lib/game/business';
import { CARGO, type CargoType } from '@/lib/game/cargo';
import { playableCountries } from '@/lib/geo/scope';
import { haversineKm } from '@/lib/geo/geometry';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, companyBranches, contracts, deliveries, loans, users } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import type { RoutingProvider } from '@/server/geo/routing';
import { companyForUser } from './company';
import { addLoad, loadHubs } from './contracts';
import { fail } from './errors';
import { post, postTreasury } from './finance';
import { membershipOf, notifyMembers, requirePermission } from './membership';
import { notify } from './notify';
import { pick, pickWeighted, rand } from './random';

// ── Branches ─────────────────────────────────────────────────────────────

/** Cities a branch may open in: the 8 biggest of every country of the game, not the base city. */
export async function branchCities(db: DbOrTx, hqCityId: number, europe = false) {
  const { rows } = await db.execute<{ id: number; name: string; country: string }>(sql`
    select id, name_bg as name, country_code as country from (
      select c.*, row_number() over (partition by country_code order by population desc) as n from ${cities} c
      where country_code in (${sql.join(playableCountries(europe).map((c) => sql`${c}`), sql`, `)}) and id <> ${hqCityId}
    ) t where n <= 8 order by country, n`);
  return rows;
}

export async function branchesOf(db: DbOrTx, organizationId: string) {
  return db
    .select({ id: companyBranches.id, cityId: companyBranches.cityId, name: cities.nameBg, country: cities.countryCode, createdAt: companyBranches.createdAt })
    .from(companyBranches)
    .innerJoin(cities, eq(cities.id, companyBranches.cityId))
    .where(eq(companyBranches.organizationId, organizationId))
    .orderBy(asc(companyBranches.createdAt));
}

/** Opens a branch (the treasury pays); as many as the company level allows. */
export async function openBranch(db: Database, actorId: string, cityId: number, now = new Date()) {
  if (!(await featureFor(db, actorId, 'branches', now))) fail('not_released', 'Това идва със следващото обновление.', 403);
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_upgrades');
    const allowed = branchSlots(actor.company.companyLevel);
    const [{ n = 0 } = {}] = await tx.select({ n: count() }).from(companyBranches).where(eq(companyBranches.organizationId, actor.company.id));
    if (n >= allowed) fail('no_slot', allowed ? `На това ниво компанията може да има ${allowed} ${allowed === 1 ? 'филиал' : 'филиала'}.` : 'Филиали се отварят от ниво 4 на компанията.');
    const ok = (await branchCities(tx, actor.company.hqCityId, await featureFor(tx, actorId, 'europe', now))).find((c) => c.id === cityId);
    if (!ok) fail('bad_city', 'Филиал се отваря в един от големите градове (не в града на базата).');
    const [row] = await tx.insert(companyBranches).values({ organizationId: actor.company.id, cityId, createdAt: now }).onConflictDoNothing().returning();
    if (!row) fail('already', 'Компанията вече има филиал там.');
    await postTreasury(tx, actor.company.id, [{ category: 'company_branch', amountCents: -BRANCH.priceCents, description: `Филиал в ${ok!.name}`, idempotencyKey: `branch:${row!.id}`, actorUserId: actorId, refType: 'company_branch', refId: row!.id }], { requireFunds: true });
    await notifyMembers(tx, actor.company.id, null, `Нов филиал: ${ok!.name}`, `Курсовете до ${ok!.name} носят +${Math.round(BRANCH.bonusShare * 100)} %, а оттам тръгват товари само за компанията.`, '/game/company/branches');
    return row!;
  });
}

export async function closeBranch(db: Database, actorId: string, branchId: string) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_upgrades');
    const [row] = await tx.delete(companyBranches).where(and(eq(companyBranches.id, branchId), eq(companyBranches.organizationId, actor.company.id))).returning();
    if (!row) fail('not_found', 'Няма такъв филиал.', 404);
    await tx.update(contracts).set({ status: 'expired' }).where(and(eq(contracts.branchOrgId, actor.company.id), eq(contracts.originCityId, row!.cityId), eq(contracts.status, 'open')));
    return row!;
  });
}

/** At settlement: a member's delivery to a branch city gets the bonus (paid by the game, game data). */
export async function branchBonus(tx: Tx, delivery: { id: string; companyId: string }, ownerId: string, destCityId: number, rewardCents: number, now: Date) {
  if (!(await featureFor(tx, ownerId, 'branches', now))) return 0;
  const m = await membershipOf(tx, ownerId);
  if (!m) return 0;
  const [b] = await tx.select({ id: companyBranches.id }).from(companyBranches).where(and(eq(companyBranches.organizationId, m.company.id), eq(companyBranches.cityId, destCityId)));
  if (!b) return 0;
  const bonus = Math.round(rewardCents * BRANCH.bonusShare);
  if (bonus > 0) await post(tx, delivery.companyId, [{ category: 'branch_bonus', amountCents: bonus, description: `Бонус от филиала на ${m.company.name}`, idempotencyKey: `delivery:${delivery.id}:branch`, refType: 'delivery', refId: delivery.id }]);
  return bonus;
}

/** Worker: every branch city keeps a few members-only loads of its own. */
export async function ensureBranchLoads(db: Database, now = new Date(), provider?: RoutingProvider) {
  const all = await db.select().from(companyBranches);
  if (!all.length) return 0;
  const open = await db
    .select({ org: contracts.branchOrgId, city: contracts.originCityId, n: count() })
    .from(contracts)
    .where(and(sql`${contracts.branchOrgId} is not null`, eq(contracts.status, 'open'), gt(contracts.expiresAt, now)))
    .groupBy(contracts.branchOrgId, contracts.originCityId);
  const hubs = await loadHubs(db);
  let created = 0;
  for (const b of all) {
    const have = open.find((o) => o.org === b.organizationId && o.city === b.cityId)?.n ?? 0;
    const origin = hubs.find((h) => h.id === b.cityId);
    if (!origin || have >= BRANCH.loads) continue;
    for (let i = have; i < BRANCH.loads; i++) {
      const cargo = (origin.produces.size ? pick([...origin.produces]) : 'pallets') as CargoType;
      const dest = pickWeighted(hubs.filter((h) => h.id !== origin.id && h.consumes.has(cargo)), (h) => {
        const km = haversineKm([origin.lat, origin.lon], [h.lat, h.lon]) * 1.25;
        return km < 60 || km > 700 ? 0 : Math.sqrt(h.population);
      });
      if (!dest) break;
      const [lo, hi] = CARGO[cargo].tons;
      const tons = Math.round((lo + rand() * (Math.min(hi, 20) - lo)) * 10) / 10;
      const id = await addLoad(db, origin.id, dest.id, cargo, tons, now, BRANCH.loadHours * 3_600_000, BRANCH.loadMultiplier, {}, provider, hubs);
      if (id) {
        await db.update(contracts).set({ branchOrgId: b.organizationId }).where(eq(contracts.id, id));
        created++;
      }
    }
  }
  return created;
}

// ── Loans ────────────────────────────────────────────────────────────────

/** The player's credit rating and what the bank offers. */
export async function creditOf(db: DbOrTx, userId: string, now = new Date()) {
  const account = await companyForUser(db, userId);
  const [u] = await db.select({ level: users.level, createdAt: users.createdAt }).from(users).where(eq(users.id, userId));
  const [d] = await db.select({ n: count(), onTime: sql<number>`count(*) filter (where ${deliveries.late} = false)::int` }).from(deliveries).where(and(eq(deliveries.companyId, account.id), eq(deliveries.status, 'completed')));
  const history = await db.select({ status: loans.status, missed: loans.missed }).from(loans).where(eq(loans.companyId, account.id));
  const rating = creditRating({
    level: u?.level ?? 1,
    deliveries: d?.n ?? 0,
    onTimeShare: d?.n ? (d.onTime ?? 0) / d.n : 0,
    paidLoans: history.filter((h) => h.status === 'paid').length,
    missedPayments: history.reduce((s, h) => s + h.missed, 0) + history.filter((h) => h.status === 'defaulted').length * 2,
    accountAgeDays: u ? (now.getTime() - u.createdAt.getTime()) / 86_400_000 : 0,
  });
  const [active] = await db.select().from(loans).where(and(eq(loans.companyId, account.id), eq(loans.status, 'active')));
  return { rating, tier: creditTier(rating), active: active ?? null, accountId: account.id };
}

/** Takes a loan: one at a time, up to what the rating allows; the money comes now. */
export async function takeLoan(db: Database, userId: string, amountCents: number, weeks: number, now = new Date()) {
  if (!(await featureFor(db, userId, 'loans', now))) fail('not_released', 'Това идва със следващото обновление.', 403);
  if (!LOAN.weeksOptions.includes(weeks as 4)) fail('bad_weeks', 'Срокът е 4, 8 или 12 седмици.');
  const c = await creditOf(db, userId, now);
  if (c.active) fail('active_loan', 'Вече имаш кредит — изплати го първо.');
  if (c.tier.maxCents <= 0) fail('no_credit', 'Кредитният ти рейтинг е твърде нисък — карай още и доставяй навреме.');
  if (amountCents < 1_000_00 || amountCents > c.tier.maxCents) fail('bad_amount', `Сумата е между 1 000 лв. и ${(c.tier.maxCents / 100).toLocaleString('bg-BG')} лв.`);
  const terms = loanTerms(amountCents, c.tier.rateBps, weeks);
  return db.transaction(async (tx) => {
    const [mine] = await tx.select({ id: loans.id }).from(loans).where(and(eq(loans.companyId, c.accountId), eq(loans.status, 'active'))).for('update');
    if (mine) fail('active_loan', 'Вече имаш кредит — изплати го първо.');
    const [loan] = await tx.insert(loans).values({ companyId: c.accountId, principalCents: amountCents, totalCents: terms.totalCents, weeklyCents: terms.weeklyCents, weeks, rateBps: c.tier.rateBps, nextDueAt: new Date(now.getTime() + 7 * 86_400_000), createdAt: now }).returning();
    await post(tx, c.accountId, [{ category: 'loan', amountCents, description: `Кредит за ${weeks} седмици`, idempotencyKey: `loan:${loan!.id}:out`, refType: 'loan', refId: loan!.id }]);
    return loan!;
  });
}

/** Pays the rest of the loan at once (no extra interest). */
export async function repayLoan(db: Database, userId: string, now = new Date()) {
  const account = await companyForUser(db, userId);
  return db.transaction(async (tx) => {
    const [loan] = await tx.select().from(loans).where(and(eq(loans.companyId, account.id), eq(loans.status, 'active'))).for('update');
    if (!loan) fail('no_loan', 'Нямаш активен кредит.', 404);
    const rest = loan!.totalCents - loan!.paidCents;
    await post(tx, account.id, [{ category: 'loan', amountCents: -rest, description: 'Предсрочно изплащане на кредит', idempotencyKey: `loan:${loan!.id}:repay`, refType: 'loan', refId: loan!.id }], { requireFunds: true });
    await tx.update(loans).set({ paidCents: loan!.totalCents, status: 'paid', closedAt: now }).where(eq(loans.id, loan!.id));
    return { paidCents: rest };
  });
}

/**
 * Worker: the weekly payments. The payment is taken even without the money
 * (the balance may go below zero) but then it counts as missed; after too
 * many missed ones the loan is in default and the rest is taken at once.
 */
export async function collectLoans(db: Database, now = new Date()) {
  const due = await db.select({ id: loans.id }).from(loans).where(and(eq(loans.status, 'active'), lte(loans.nextDueAt, now))).limit(200);
  for (const { id } of due) {
    await db.transaction(async (tx) => {
      const [loan] = await tx.select().from(loans).where(and(eq(loans.id, id), eq(loans.status, 'active'), lte(loans.nextDueAt, now))).for('update');
      if (!loan) return;
      const [acc] = await tx.select({ balance: companies.balanceCents, ownerId: companies.ownerId }).from(companies).where(eq(companies.id, loan.companyId));
      const week = Math.round((loan.nextDueAt.getTime() - loan.createdAt.getTime()) / (7 * 86_400_000));
      const missedNow = (acc?.balance ?? 0) < loan.weeklyCents;
      const missed = loan.missed + (missedNow ? 1 : 0);
      const defaulted = missed > LOAN.maxMissed;
      const amount = defaulted ? loan.totalCents - loan.paidCents : Math.min(loan.weeklyCents, loan.totalCents - loan.paidCents);
      await post(tx, loan.companyId, [{ category: 'loan', amountCents: -amount, description: defaulted ? 'Кредит: просрочие — събран остатъкът' : `Вноска по кредит (${week}/${loan.weeks})`, idempotencyKey: `loan:${loan.id}:week:${week}`, refType: 'loan', refId: loan.id }]);
      const paid = loan.paidCents + amount;
      const done = paid >= loan.totalCents;
      await tx.update(loans).set({ paidCents: paid, missed, status: defaulted ? 'defaulted' : done ? 'paid' : 'active', nextDueAt: new Date(loan.nextDueAt.getTime() + 7 * 86_400_000), closedAt: defaulted || done ? now : null }).where(eq(loans.id, loan.id));
      if (acc && (missedNow || defaulted || done)) {
        await notify(tx, acc.ownerId, defaulted || missedNow ? 'warning' : 'success', defaulted ? 'Кредитът е просрочен' : missedNow ? 'Пропусната вноска по кредита' : 'Кредитът е изплатен 🎉', defaulted ? 'Остатъкът е събран наведнъж, а кредитният ти рейтинг падна.' : missedNow ? 'Нямаше достатъчно пари — вноската е взета на минус и рейтингът ти пада.' : 'Кредитният ти рейтинг се повиши.', '/game/finance#credit');
      }
    });
  }
  return due.length;
}

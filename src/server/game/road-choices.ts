import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { CHOICES, choiceOutcome, ROAD_CHOICES, scenarioById, shrinkAfter } from '@/lib/game/road-choices';
import { insertStop } from '@/lib/game/road-events';
import { scheduleEnd, type Segment } from '@/lib/game/schedule';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, contracts, deliveries, vehicles } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { notify } from './notify';
import { awardXp } from './progression';
import { t } from '@/i18n/t';

const MIN = 60_000;
type Choice = NonNullable<typeof deliveries.$inferSelect.choice>;

/** At acceptance: some longer trips get a decision half-way. */
export async function planChoice(tx: DbOrTx, userId: string, schedule: Segment[], now: Date, random = Math.random): Promise<Choice | null> {
  if (!schedule.length || !(await featureFor(tx, userId, 'road_choices', now))) return null;
  const end = scheduleEnd(schedule);
  if ((end - now.getTime()) / MIN < CHOICES.minTripMin || random() >= CHOICES.chance) return null;
  const scenario = ROAD_CHOICES[Math.floor(random() * ROAD_CHOICES.length)]!;
  const at = Math.round(now.getTime() + (end - now.getTime()) * (0.35 + random() * 0.25));
  return { id: scenario.id, at, deadline: at + CHOICES.windowMin * MIN };
}

/** The choice is made (by the player, or the calm one when the time is up). */
async function apply(tx: Tx, d: typeof deliveries.$inferSelect, option: 'a' | 'b', now: Date, random: () => number) {
  const c = d.choice!;
  const scenario = scenarioById(c.id);
  if (!scenario) return null;
  const [contract] = await tx.select({ rewardCents: contracts.rewardCents }).from(contracts).where(eq(contracts.id, d.contractId));
  const out = choiceOutcome(scenario[option], random());
  let schedule = d.schedule as Segment[];
  const at = Math.max(now.getTime(), c.at);
  if (out.delayMin) schedule = insertStop(schedule, at, out.delayMin * MIN, scenario.title);
  if (out.saveMin) schedule = shrinkAfter(schedule, at, out.saveMin * MIN);
  const reward = contract?.rewardCents ?? 0;
  const choice: Choice = { ...c, decided: option, result: out.result, costCents: Math.round(reward * out.costShare), bonusCents: Math.round(reward * out.bonusShare), xpShare: out.xpShare };
  await tx.update(deliveries).set({ schedule, etaAt: new Date(scheduleEnd(schedule)), choice }).where(eq(deliveries.id, d.id));
  return choice;
}

export async function decideChoice(db: Database, userId: string, deliveryId: string, option: 'a' | 'b', now = new Date(), random = Math.random) {
  return db.transaction(async (tx) => {
    const account = await companyForUser(tx, userId);
    const [d] = await tx.select().from(deliveries).where(and(eq(deliveries.id, deliveryId), eq(deliveries.companyId, account.id), eq(deliveries.status, 'in_progress'))).for('update');
    if (!d?.choice) fail('not_found', t('Няма решение за този курс.'), 404);
    if (d!.choice!.decided) fail('already', t('Решението вече е взето.'));
    if (now.getTime() < d!.choice!.at) fail('too_early', t('Още не сте стигнали дотам.'));
    if (now.getTime() > d!.choice!.deadline) fail('too_late', t('Времето за решение изтече.'));
    const c = await apply(tx, d!, option, now, random);
    return { result: c?.result ?? '' };
  });
}

/** Worker, every minute: tell the player when a decision comes up; take the calm option when the time is up. */
export async function tickChoices(db: Database, now = new Date(), random = Math.random) {
  const rows = await db.select().from(deliveries).where(and(eq(deliveries.status, 'in_progress'), isNotNull(deliveries.choice), sql`(${deliveries.choice}->>'decided') is null`, sql`(${deliveries.choice}->>'at')::bigint <= ${now.getTime()}`));
  let n = 0;
  for (const r of rows) {
    await db.transaction(async (tx) => {
      const [d] = await tx.select().from(deliveries).where(eq(deliveries.id, r.id)).for('update');
      if (!d?.choice || d.choice.decided || d.status !== 'in_progress') return;
      const scenario = scenarioById(d.choice.id);
      const [owner] = await tx.select({ ownerId: companies.ownerId }).from(companies).where(eq(companies.id, d.companyId));
      if (now.getTime() > d.choice.deadline) {
        const c = await apply(tx, d, CHOICES.defaultOption, now, random);
        if (owner && c) await notify(tx, owner.ownerId, 'info', () => t('{0} Шофьорът реши сам', scenario?.emoji ?? '🛣️'), `${scenario?.title ?? ''}: ${c.result}`, '/game/fleet');
        n++;
      } else if (!d.choice.notified) {
        await tx.update(deliveries).set({ choice: { ...d.choice, notified: true } }).where(eq(deliveries.id, d.id));
        if (owner && scenario) await notify(tx, owner.ownerId, 'warning', () => t('{0} Решение на пътя: {1}', scenario.emoji, scenario.title), () => t('{0} Имаш {1} мин да избереш.', scenario.text, CHOICES.windowMin), '/game/fleet');
        n++;
      }
    });
  }
  return n;
}

/** On arrival: the extra cost or the bonus of the choice (personal account). */
export async function choiceMoney(tx: Tx, d: { id: string; companyId: string; choice: Choice | null }) {
  const c = d.choice;
  if (!c?.decided) return 0;
  const scenario = scenarioById(c.id);
  const lines = [
    ...(c.costCents ? [{ category: 'road_events' as const, amountCents: -c.costCents, description: t('Решение по пътя: {0}', scenario?.title ?? ''), idempotencyKey: `delivery:${d.id}:choice-cost`, refType: 'delivery', refId: d.id }] : []),
    ...(c.bonusCents ? [{ category: 'bonus' as const, amountCents: c.bonusCents, description: t('Решение по пътя: {0}', scenario?.title ?? ''), idempotencyKey: `delivery:${d.id}:choice-bonus`, refType: 'delivery', refId: d.id }] : []),
  ];
  if (lines.length) await post(tx, d.companyId, lines);
  return (c.bonusCents ?? 0) - (c.costCents ?? 0);
}

export async function choiceXp(tx: Tx, userId: string, d: { choice: Choice | null }, baseXp: number) {
  const share = d.choice?.decided ? (d.choice.xpShare ?? 0) : 0;
  const xp = Math.round(baseXp * share);
  if (xp > 0) await awardXp(tx, userId, xp, 'other');
  return xp;
}

/** The decisions waiting for this player now. */
export async function pendingChoices(db: DbOrTx, companyId: string, now: Date) {
  const rows = await db
    .select({ id: deliveries.id, choice: deliveries.choice, plate: vehicles.plate, dest: cities.nameBg })
    .from(deliveries)
    .innerJoin(vehicles, eq(vehicles.id, deliveries.vehicleId))
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .innerJoin(cities, eq(cities.id, contracts.destCityId))
    .where(and(eq(deliveries.companyId, companyId), eq(deliveries.status, 'in_progress'), isNotNull(deliveries.choice), sql`(${deliveries.choice}->>'decided') is null`, sql`(${deliveries.choice}->>'at')::bigint <= ${now.getTime()}`));
  return rows.flatMap((r) => {
    const s = r.choice ? scenarioById(r.choice.id) : null;
    return s && r.choice ? [{ deliveryId: r.id, plate: r.plate, dest: r.dest, deadline: r.choice.deadline, scenario: s }] : [];
  });
}

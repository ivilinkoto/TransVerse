/**
 * 1.3 „Световни кризи“ on the server. job_state keeps `crisis:<n>` = { votes, tons }
 * (n is the crisis's serial number) and one vote per player under
 * `crisis-vote:<n>:<user>`. Deliveries to the crisis country count tonnes for the
 * day; in the week after, deliveries to the winning way's country pay its bonus
 * as one ledger line (`delivery:<id>:crisis`).
 */
import { eq, sql } from 'drizzle-orm';
import { CRISES, CRISIS_RULES, crisisAt, crisisOutcome, nextCrisisDay } from '@/lib/game/crises';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { jobState } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { fail } from './errors';
import { post } from './finance';
import { t } from '@/i18n/t';

interface CrisisState { votes: { a: number; b: number }; tons: number[] }
const stateKey = (n: number) => `crisis:${n}`;
const voteKey = (n: number, userId: string) => `crisis-vote:${n}:${userId}`;
const empty = (): CrisisState => ({ votes: { a: 0, b: 0 }, tons: [0, 0, 0] });

async function readState(db: DbOrTx, n: number): Promise<CrisisState> {
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, stateKey(n)));
  return (row?.value as CrisisState | undefined) ?? empty();
}

/** One vote per player, during the three crisis days. */
export async function voteCrisis(db: Database, userId: string, option: 'a' | 'b', now: Date) {
  const m = crisisAt(now);
  if (!m || m.phase !== 'crisis') fail('no_crisis', t('Сега няма криза, за която да се гласува.'));
  return db.transaction(async (tx) => {
    const [made] = await tx.insert(jobState).values({ key: voteKey(m!.n, userId), value: { option }, updatedAt: now }).onConflictDoNothing().returning({ key: jobState.key });
    if (!made) fail('voted', t('Вече гласува в тази криза.'));
    await tx.insert(jobState).values({ key: stateKey(m!.n), value: empty(), updatedAt: now }).onConflictDoNothing();
    await tx
      .update(jobState)
      .set({ value: sql`jsonb_set(${jobState.value}, ${`{votes,${option}}`}::text[], to_jsonb(coalesce((${jobState.value}->'votes'->>${option})::int, 0) + 1))`, updatedAt: now })
      .where(eq(jobState.key, stateKey(m!.n)));
  });
}

export interface CrisisTrip { userId: string; companyId: string; deliveryId: string; destCountry: string; tons: number; rewardCents: number }

/** A delivery arrived: tonnes for the crisis day, or the winning way's bonus in the week after. */
export async function recordCrisisDelivery(tx: Tx, f: CrisisTrip, at: Date) {
  const m = crisisAt(at);
  if (!m || !(await featureFor(tx, f.userId, 'world_crises', at))) return;
  const def = CRISES[m.id]!;
  if (m.phase === 'crisis') {
    if (f.destCountry !== def.country) return;
    await tx.insert(jobState).values({ key: stateKey(m.n), value: empty(), updatedAt: at }).onConflictDoNothing();
    await tx
      .update(jobState)
      .set({ value: sql`jsonb_set(${jobState.value}, ${`{tons,${m.dayIndex}}`}::text[], to_jsonb(coalesce((${jobState.value}->'tons'->>${m.dayIndex})::numeric, 0) + ${Math.round(f.tons * 10) / 10}))`, updatedAt: at })
      .where(eq(jobState.key, stateKey(m.n)));
    return;
  }
  const st = await readState(tx, m.n);
  const out = crisisOutcome(st.votes, st.tons.filter((x) => x >= CRISIS_RULES.dailyTons).length);
  const way = def.options[out.option];
  if (f.destCountry !== way.country) return;
  const cents = Math.round(f.rewardCents * out.share);
  if (cents > 0) await post(tx, f.companyId, [{ category: 'bonus', amountCents: cents, description: t('Криза: {0}', way.label), idempotencyKey: `delivery:${f.deliveryId}:crisis`, refType: 'delivery', refId: f.deliveryId }]);
}

/** The page: the crisis now (the day's story, today's tonnes, the votes and my vote, or the effect), else the next one. */
export async function crisisView(db: DbOrTx, userId: string, now: Date) {
  const m = crisisAt(now);
  if (!m) return { moment: null, next: nextCrisisDay(now) } as const;
  const def = CRISES[m.id]!;
  const st = await readState(db, m.n);
  const [mine] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, voteKey(m.n, userId)));
  const goalsMet = st.tons.filter((x) => x >= CRISIS_RULES.dailyTons).length;
  const outcome = m.phase === 'effect' ? crisisOutcome(st.votes, goalsMet) : null;
  const effectEnds = new Date(Date.parse(`${m.startDay}T00:00:00+02:00`) + (CRISIS_RULES.crisisDays + CRISIS_RULES.effectDays) * 86_400_000);
  return { moment: m, def, state: st, myVote: (mine?.value as { option: 'a' | 'b' } | undefined)?.option ?? null, goalsMet, outcome, effectEnds, next: nextCrisisDay(now) } as const;
}

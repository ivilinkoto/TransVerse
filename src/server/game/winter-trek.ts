/**
 * 1.3 „Зимен път“: „Зимен поход“ on the server. The player's progress lives in
 * job_state under `winter-trek:<user>` = { step, p, countries }: `step` steps are
 * done, `p` is the progress on the current one (and `countries` the countries
 * it has seen). A delivery the player drives themselves counts for the current
 * step while that step is open; finishing it pays at once.
 */
import { eq } from 'drizzle-orm';
import { TREK_STEPS, trekIncrement, trekOpen, trekStepDay, trekUnlocked, WINTER_TREK } from '@/lib/game/winter-trek';
import type { DbOrTx, Tx } from '@/server/db/client';
import { companies, jobState } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { postCoins } from './coins';
import { post } from './finance';
import { grantItem } from './inventory';
import { notify } from './notify';
import { t, tx as text } from '@/i18n/t';

interface TrekState { step: number; p: number; countries: string[] }

const trekKey = (userId: string) => `winter-trek:${userId}`;

/**
 * The steps open for this viewer: from the release one more each day. The staff
 * try the first step before the release (the rest open with the real dates).
 */
async function openSteps(db: DbOrTx, userId: string, now: Date): Promise<number> {
  if (!(await featureFor(db, userId, 'winter_trek', now))) return 0;
  if (now >= new Date(WINTER_TREK.to)) return 0;
  return Math.max(trekOpen(now) ? trekUnlocked(now) : 0, now < new Date(WINTER_TREK.from) ? 1 : 0);
}

async function readState(db: DbOrTx, userId: string): Promise<TrekState> {
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, trekKey(userId)));
  return (row?.value as TrekState | undefined) ?? { step: 0, p: 0, countries: [] };
}

export interface TrekFacts { userId: string; loadedKm: number; late: boolean; cargoType: string; destCountry: string; tons: number; ownerDrove: boolean }

/** A delivery arrived: progress on the current step, and its reward when it is done. */
export async function recordWinterTrek(tx: Tx, f: TrekFacts, at: Date) {
  if (!f.ownerDrove) return;
  const open = await openSteps(tx, f.userId, at);
  if (open === 0) return;
  const key = trekKey(f.userId);
  await tx.insert(jobState).values({ key, value: { step: 0, p: 0, countries: [] } }).onConflictDoNothing();
  const [row] = await tx.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key)).for('update');
  const st = row!.value as TrekState;
  // Done with the trek, or ahead of the calendar: the next step opens tomorrow.
  if (st.step >= TREK_STEPS.length || st.step >= open) return;
  const step = TREK_STEPS[st.step]!;
  const p = st.p + trekIncrement(step.kind, f, st.countries);
  const countries = step.kind === 'countries' && !st.countries.includes(f.destCountry) ? [...st.countries, f.destCountry] : st.countries;
  if (p < step.target) {
    await tx.update(jobState).set({ value: { step: st.step, p, countries }, updatedAt: at }).where(eq(jobState.key, key));
    return;
  }
  const done = st.step + 1;
  await tx.update(jobState).set({ value: { step: done, p: 0, countries: [] }, updatedAt: at }).where(eq(jobState.key, key));
  const [company] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, f.userId));
  const rewardKey = `winter-trek:${f.userId}:${done}`;
  if (company && step.cents > 0) await post(tx, company.id, [{ category: 'bonus', amountCents: step.cents, description: t('Зимен поход: стъпка {0}', done), idempotencyKey: rewardKey }]);
  if (step.coins > 0) await postCoins(tx, f.userId, { amount: step.coins, reason: 'winter_trek', description: t('Зимен поход: стъпка {0}', done), idempotencyKey: rewardKey, at });
  if (step.item) await grantItem(tx, f.userId, step.item, 1, 'winter_trek', `${rewardKey}:item`);
  const last = done === TREK_STEPS.length;
  await notify(
    tx,
    f.userId,
    'achievement',
    () => (last ? t('Зимен поход: извървян докрай!') : t('Зимен поход: стъпка {0} от {1}', done, TREK_STEPS.length)),
    () => (last ? t('Боя „Скреж“ е в инвентара ти. Браво!') : t('{0} — готово. Следващата стъпка се отваря утре.', text(step.label))),
    '/game/missions',
  );
}

export type TrekStepState = 'done' | 'current' | 'waiting' | 'locked';

/** The trek for the missions page and the dashboard (null when it is not on for this viewer). */
export async function winterTrekView(db: DbOrTx, userId: string, now: Date) {
  if (!(await featureFor(db, userId, 'winter_trek', now))) return null;
  if (now >= new Date(WINTER_TREK.to)) return null;
  const open = await openSteps(db, userId, now);
  const st = await readState(db, userId);
  const steps = TREK_STEPS.map((s, i) => {
    const state: TrekStepState = i < st.step ? 'done' : i >= open ? 'locked' : i === st.step ? 'current' : 'waiting';
    return { ...s, index: i, state, progress: i === st.step ? Math.min(s.target, st.p) : i < st.step ? s.target : 0, opensOn: trekStepDay(i) };
  });
  return { steps, done: st.step, total: TREK_STEPS.length, finished: st.step >= TREK_STEPS.length, open, endsAt: new Date(WINTER_TREK.to) };
}

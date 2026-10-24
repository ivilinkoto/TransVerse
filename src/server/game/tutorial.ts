import { eq, sql } from 'drizzle-orm';
import { ECONOMY } from '@/lib/game/economy';
import { TUTORIAL, type TutorialKey } from '@/lib/game/tutorial';
import type { Database } from '@/server/db/client';
import { companies, deliveries, users } from '@/server/db/schema';
import { fail } from './errors';
import { post } from './finance';
import { notify } from './notify';
import { awardXp } from './progression';
import { t as tr } from '@/i18n/t';

export interface TutorialView {
  active: boolean;
  step: (typeof TUTORIAL)[number] | null;
  index: number;
  total: number;
  done: TutorialKey[];
}

/** Current onboarding state; grants the completion reward once when every step is done. */
export async function tutorialState(db: Database, userId: string): Promise<TutorialView> {
  const [user] = await db.select({ tutorial: users.tutorial }).from(users).where(eq(users.id, userId));
  const [company] = await db.select().from(companies).where(eq(companies.ownerId, userId));
  const t = user?.tutorial ?? { done: [] };
  const done = new Set<TutorialKey>(t.done as TutorialKey[]);
  if (company) {
    const [{ n = 0 } = {}] = await db.select({ n: sql<number>`count(*)::int` }).from(deliveries).where(eq(deliveries.companyId, company.id));
    if (n > 0) done.add('first_contract');
    if (company.deliveries > 0) done.add('first_delivery');
    if (company.kind === 'company') done.add('company_goal');
  }
  const index = TUTORIAL.findIndex((s) => !done.has(s.key));
  if (index === -1 && !t.rewarded && company) await rewardOnce(db, userId, company.id);
  return { active: !t.dismissed && index !== -1, step: index === -1 ? null : TUTORIAL[index]!, index: index === -1 ? TUTORIAL.length : index, total: TUTORIAL.length, done: [...done] };
}

async function rewardOnce(db: Database, userId: string, companyId: string) {
  await db.transaction(async (tx) => {
    const [u] = await tx.select({ tutorial: users.tutorial }).from(users).where(eq(users.id, userId)).for('update');
    if (u?.tutorial.rewarded) return;
    await tx.update(users).set({ tutorial: { ...(u?.tutorial ?? { done: [] }), rewarded: true } }).where(eq(users.id, userId));
    await post(tx, companyId, [{ category: 'tutorial_reward', amountCents: ECONOMY.tutorialRewardCents, description: tr('Завършено обучение'), idempotencyKey: `tutorial:${userId}` }]);
    await awardXp(tx, userId, ECONOMY.tutorialRewardXp, 'tutorial');
    await notify(tx, userId, 'achievement', () => tr('Обучението е завършено!'), () => tr('Награда: {0} лв. и {1} опит.', ECONOMY.tutorialRewardCents / 100, ECONOMY.tutorialRewardXp), '/game/finance');
  });
}

/** Marks a step done by player action ("ack" or a page visit). Auto steps cannot be forced. */
export async function completeTutorialStep(db: Database, userId: string, key: string) {
  const step = TUTORIAL.find((s) => s.key === key);
  if (!step) fail('unknown_step', tr('Непозната стъпка.'));
  if (step!.completion === 'auto') fail('auto_step', tr('Тази стъпка се отчита автоматично.'));
  await db.execute(sql`
    update users set tutorial = jsonb_set(tutorial, '{done}', (select to_jsonb(array(select distinct e from jsonb_array_elements_text(coalesce(tutorial->'done', '[]'::jsonb) || ${JSON.stringify([key])}::jsonb) e))))
    where id = ${userId}`);
}

export async function setTutorialDismissed(db: Database, userId: string, dismissed: boolean) {
  await db.execute(sql`update users set tutorial = tutorial || ${JSON.stringify({ dismissed })}::jsonb where id = ${userId}`);
}

import { eq } from 'drizzle-orm';
import { featureLive } from '@/lib/game/features';
import { STORY, STORY_BADGE, taskStep } from '@/lib/game/story';
import type { DbOrTx, Tx } from '@/server/db/client';
import { storyProgress, userBadges, users } from '@/server/db/schema';
import { postCoins } from './coins';
import { post } from './finance';
import { notify } from './notify';
import { awardXp } from './progression';
import { t as tr } from '@/i18n/t';

export async function storyOf(db: DbOrTx, userId: string) {
  const [p] = await db.select().from(storyProgress).where(eq(storyProgress.userId, userId));
  return p ?? { userId, chapter: 0, counts: [0, 0, 0], cities: [] as number[], startedAt: new Date(0), finishedAt: null };
}

/** A delivery moves the current chapter on; a finished chapter pays and opens the next one. */
export async function storyDelivered(tx: Tx, userId: string, accountId: string, d: { onTime: boolean; km: number; tons: number; foreign: boolean; convoy: boolean; destCityId: number }, at: Date) {
  if (!featureLive('story', at)) return;
  const p = await storyOf(tx, userId);
  const chapter = STORY[p.chapter];
  if (!chapter) return;
  const [u] = await tx.select({ level: users.level }).from(users).where(eq(users.id, userId));
  if ((u?.level ?? 1) < chapter.minLevel) return;
  const newCity = !p.cities.includes(d.destCityId);
  const counts = chapter.tasks.map((t, i) => Math.min(t.target, (p.counts[i] ?? 0) + taskStep(t, { ...d, newCity })));
  const cities = newCity ? [...p.cities, d.destCityId] : p.cities;
  const done = chapter.tasks.every((t, i) => counts[i]! >= t.target);
  if (!done) {
    await tx.insert(storyProgress).values({ userId, chapter: p.chapter, counts, cities }).onConflictDoUpdate({ target: storyProgress.userId, set: { counts, cities } });
    return;
  }
  const next = p.chapter + 1;
  const last = next >= STORY.length;
  await tx.insert(storyProgress).values({ userId, chapter: next, counts: [0, 0, 0], cities: [], startedAt: at, finishedAt: last ? at : null }).onConflictDoUpdate({ target: storyProgress.userId, set: { chapter: next, counts: [0, 0, 0], cities: [], startedAt: at, finishedAt: last ? at : null } });
  const key = `story:${p.chapter}:${userId}`;
  await post(tx, accountId, [{ category: 'achievement_reward', amountCents: chapter.rewardCents, description: tr('Историята: „{0}“', chapter.title), idempotencyKey: key }]);
  await awardXp(tx, userId, chapter.xp, 'achievement');
  await postCoins(tx, userId, { amount: chapter.coins, reason: 'story', description: tr('Историята: „{0}“', chapter.title), idempotencyKey: key });
  if (last) await tx.insert(userBadges).values({ userId, badge: STORY_BADGE, awardedAt: at }).onConflictDoNothing();
  await notify(tx, userId, 'achievement', () => tr('Глава {0} завърши: „{1}“ 📖', p.chapter + 1, chapter.title), () => tr('{0} Награда: +{1} опит и {2} TC.', chapter.outro, chapter.xp, chapter.coins), '/game/story');
}

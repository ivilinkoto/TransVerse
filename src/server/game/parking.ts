import { dayKey } from '@/lib/game/daily';
import { PARKING, replayParking } from '@/lib/game/parking';
import type { Database } from '@/server/db/client';
import { jobState } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { fail } from './errors';
import { awardXp } from './progression';

/** The daily parking run: the server replays the steering and gives XP by the stars (once a day). */
export async function playParking(db: Database, userId: string, inputs: number[], now = new Date()) {
  if (!(await featureFor(db, userId, 'parking_game', now))) fail('not_released', 'Това идва със следващото обновление.', 403);
  if (inputs.length > PARKING.maxTicks) fail('too_long', 'Твърде дълго паркиране.');
  const day = dayKey(now);
  const result = replayParking(day, inputs);
  return db.transaction(async (tx) => {
    const [first] = await tx.insert(jobState).values({ key: `parking:${userId}:${day}`, value: { stars: result.stars } }).onConflictDoNothing().returning({ key: jobState.key });
    if (!first) fail('already', 'Днес вече паркира — утре те чака нова рампа.');
    const xp = PARKING.xp[result.stars] ?? 0;
    if (xp) await awardXp(tx, userId, xp, 'parking');
    return { stars: result.stars, xp, crashed: result.crashed, dist: Math.round(result.dist * 10) / 10 };
  });
}

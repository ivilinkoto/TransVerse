/**
 * 1.3 „Талисман в кабината“ on the server. The mascot lives in job_state under
 * `mascot:<user>` (a MascotState). Every delivery of the player's company feeds
 * it (trips and mood) and, while it is in a good mood, pays its share of the
 * reward through the ledger (`delivery:<id>:mascot`).
 */
import { eq } from 'drizzle-orm';
import { ACCESSORIES, cleanMascotName, favouriteTrip, MASCOT, MASCOTS, mascotBonusCents, mascotLevel, moodNow, type Accessory, type MascotKind, type MascotState } from '@/lib/game/mascot';
import type { DbOrTx, Tx } from '@/server/db/client';
import { jobState } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { fail } from './errors';
import { post } from './finance';
import { notify } from './notify';
import { t, tx as text } from '@/i18n/t';

const key = (userId: string) => `mascot:${userId}`;

export async function getMascot(db: DbOrTx, userId: string): Promise<MascotState | null> {
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key(userId)));
  return (row?.value as MascotState | undefined) ?? null;
}

async function save(db: DbOrTx, userId: string, st: MascotState, at: Date) {
  await db.update(jobState).set({ value: st, updatedAt: at }).where(eq(jobState.key, key(userId)));
}

/** Takes a mascot home (once): the kind and a name. */
export async function adoptMascot(db: DbOrTx, userId: string, kind: MascotKind, rawName: string, now: Date) {
  if (!(kind in MASCOTS)) fail('bad_kind', t('Няма такъв талисман.'));
  const name = cleanMascotName(rawName) ?? MASCOTS[kind].name;
  const st: MascotState = { kind, name, trips: 0, mood: MASCOT.mood.start, moodAt: now.toISOString(), pettedAt: null, accessory: null, adoptedAt: now.toISOString() };
  const [made] = await db.insert(jobState).values({ key: key(userId), value: st, updatedAt: now }).onConflictDoNothing().returning({ key: jobState.key });
  if (!made) fail('has_mascot', t('Вече имаш талисман.'));
  return st;
}

export async function renameMascot(db: DbOrTx, userId: string, rawName: string, now: Date) {
  const st = await getMascot(db, userId);
  if (!st) fail('no_mascot', t('Още нямаш талисман.'));
  const name = cleanMascotName(rawName);
  if (!name) fail('bad_name', t('Името трябва да е от 2 до {0} знака.', MASCOT.nameMax));
  await save(db, userId, { ...st!, name: name! }, now);
  return name!;
}

/** Petting: a little mood, once every few hours. */
export async function petMascot(db: DbOrTx, userId: string, now: Date) {
  const st = await getMascot(db, userId);
  if (!st) fail('no_mascot', t('Още нямаш талисман.'));
  if (st!.pettedAt && now.getTime() - new Date(st!.pettedAt).getTime() < MASCOT.petEveryHours * 3_600_000) fail('too_soon', t('{0} още се радва на последното галене.', st!.name));
  const mood = Math.min(100, moodNow(st!, now) + MASCOT.mood.perPet);
  await save(db, userId, { ...st!, mood, moodAt: now.toISOString(), pettedAt: now.toISOString() }, now);
  return mood;
}

/** Puts on an accessory the mascot's level allows (null takes it off). */
export async function setMascotAccessory(db: DbOrTx, userId: string, accessory: Accessory | null, now: Date) {
  const st = await getMascot(db, userId);
  if (!st) fail('no_mascot', t('Още нямаш талисман.'));
  if (accessory && mascotLevel(st!.trips) < ACCESSORIES[accessory].level) fail('locked', t('Отключва се на ниво {0}.', ACCESSORIES[accessory].level));
  await save(db, userId, { ...st!, accessory }, now);
}

export interface MascotTrip { userId: string; companyId: string; deliveryId: string; rewardCents: number; loadedKm: number; tons: number; originCountry: string; destCountry: string }

const sofiaHour = (at: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', hour: '2-digit', hourCycle: 'h23' }).format(at));

/** A delivery arrived: the mascot's share (by its mood before the trip), then trips and mood. */
export async function recordMascotTrip(tx: Tx, f: MascotTrip, at: Date) {
  if (!(await featureFor(tx, f.userId, 'mascot', at))) return;
  const [row] = await tx.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key(f.userId))).for('update');
  const st = row?.value as MascotState | undefined;
  if (!st) return;
  const favourite = favouriteTrip(st.kind, { ...f, sofiaHour: sofiaHour(at) });
  const cents = mascotBonusCents(st, f.rewardCents, favourite, at);
  if (cents > 0) await post(tx, f.companyId, [{ category: 'bonus', amountCents: cents, description: favourite ? t('{0} (любим курс)', st.name) : t('{0} (талисман)', st.name), idempotencyKey: `delivery:${f.deliveryId}:mascot`, refType: 'delivery', refId: f.deliveryId }]);
  const before = mascotLevel(st.trips);
  const trips = st.trips + 1;
  const mood = Math.min(100, moodNow(st, at) + MASCOT.mood.perTrip);
  await save(tx, f.userId, { ...st, trips, mood, moodAt: at.toISOString() }, at);
  const level = mascotLevel(trips);
  if (level > before) {
    const unlocked = (Object.entries(ACCESSORIES) as [Accessory, { label: string; level: number }][]).find(([, a]) => a.level === level);
    await notify(
      tx,
      f.userId,
      'achievement',
      () => t('{0} стана ниво {1}!', st.name, level),
      () => (unlocked ? t('Отключи аксесоар: {0}. Бонусът е {1}% от заплащането.', text(unlocked[1].label), MASCOT.bonus(level) * 100) : t('Бонусът е {0}% от заплащането.', MASCOT.bonus(level) * 100)),
      '/game/mascot',
    );
  }
}

/** The mascot for its page and the profile (null without one). */
export async function mascotView(db: DbOrTx, userId: string, now: Date) {
  const st = await getMascot(db, userId);
  if (!st) return null;
  const level = mascotLevel(st.trips);
  const mood = moodNow(st, now);
  const nextPetAt = st.pettedAt ? new Date(new Date(st.pettedAt).getTime() + MASCOT.petEveryHours * 3_600_000) : null;
  return { ...st, level, mood, bonusPct: MASCOT.bonus(level) * 100, sad: mood < MASCOT.mood.sadBelow, canPet: !nextPetAt || nextPetAt <= now, nextPetAt };
}

import { and, eq, gt, sql } from 'drizzle-orm';
import { BADGES } from '@/lib/game/halloween';
import { DEFAULT_REWARDS, EVENT_METRIC_INFO } from '@/lib/game/events';
import { featureLive } from '@/lib/game/features';
import { RELIEF } from '@/lib/game/relief';
import { haversineKm } from '@/lib/geo/geometry';
import { playableCountries } from '@/lib/geo/scope';
import type { Database, Tx } from '@/server/db/client';
import { companies, contracts, countries, globalEvents, jobState, userBadges } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { announce as announceDiscord } from '@/server/discord/outbox';
import { appUrl } from '@/server/discord/config';
import { postCoins } from './coins';
import { addLoad, loadHubs } from './contracts';
import { announce } from './events';
import { notify } from './notify';

const STATE = 'humanitarian';
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)]!;

/**
 * Keeps humanitarian convoys going: every three weeks one starts in a
 * country of the game (a community event for two days), and while it runs
 * the board has relief loads into that country.
 */
export async function runRelief(db: Database, now = new Date()) {
  if (!featureLive('humanitarian', now)) return null;
  const [state] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, STATE));
  let current = state?.value as { eventId: string; country: string; startedAt: string; endsAt: string } | undefined;
  if (!current || now.getTime() - Date.parse(current.startedAt) >= RELIEF.everyDays * 86_400_000) current = (await startRelief(db, now)) ?? current;
  if (!current || Date.parse(current.endsAt) <= now.getTime()) return null;
  await topUpLoads(db, current.country, new Date(current.endsAt), now);
  return current;
}

async function startRelief(db: Database, now: Date) {
  const hubs = await loadHubs(db, { now });
  const choices = playableCountries(featureLive('europe', now)).filter((c) => hubs.some((h) => h.countryCode === c && h.population >= 50_000));
  if (!choices.length) return null;
  const code = pick(choices);
  const [country] = await db.select({ nameBg: countries.nameBg }).from(countries).where(eq(countries.code, code));
  const cause = pick(RELIEF.causes);
  const endsAt = new Date(now.getTime() + RELIEF.hours * 3_600_000);
  const value = await db.transaction(async (tx) => {
    const [e] = await tx
      .insert(globalEvents)
      .values({
        name: `Хуманитарен конвой: ${country?.nameBg ?? code}`,
        description: `Игрово събитие: ${cause} в ${country?.nameBg ?? code}. Всички заедно караме помощи — брои се всяка доставка по маршрут през държавата, а товарите „Хуманитарна помощ“ носят и ТрансКоин.`,
        metric: 'deliveries',
        countryCode: code,
        cargoType: null,
        target: RELIEF.target,
        minContribution: EVENT_METRIC_INFO.deliveries.minContribution,
        rewards: { participant: RELIEF.rewards.participant, top: DEFAULT_REWARDS.top.slice(0, 3) },
        startsAt: now,
        endsAt,
      })
      .returning();
    await announce(tx, e!, now);
    const v = { eventId: e!.id, country: code, startedAt: now.toISOString(), endsAt: endsAt.toISOString() };
    await tx.insert(jobState).values({ key: STATE, value: v }).onConflictDoUpdate({ target: jobState.key, set: { value: v, updatedAt: now } });
    if (featureLive('discord_bot', now)) {
      await announceDiscord(tx, `humanitarian:${e!.id}`, 'events', {
        embeds: [{ title: `🆘 Хуманитарен конвой: ${country?.nameBg ?? code}`, url: `${appUrl()}/game/events`, color: 0xef4444, description: `${cause[0]!.toUpperCase()}${cause.slice(1)} (игрово събитие). Два дни караме помощи — всяка доставка през държавата се брои, а товарите „Хуманитарна помощ“ носят ТрансКоин и значка.`, footer: { text: 'TransVerse · игрови данни' } }],
      }, now);
    }
    return v;
  });
  return value;
}

/** Relief loads into the country from cities around it, up to the number open at once. */
async function topUpLoads(db: Database, country: string, endsAt: Date, now: Date) {
  const [{ open = 0 } = {}] = await db.select({ open: sql<number>`count(*)::int` }).from(contracts).where(and(eq(contracts.humanitarian, true), eq(contracts.status, 'open'), gt(contracts.expiresAt, now)));
  if (open >= RELIEF.openLoads) return 0;
  const hubs = await loadHubs(db, { now });
  const targets = hubs.filter((h) => h.countryCode === country).sort((a, b) => b.population - a.population).slice(0, 6);
  let made = 0;
  for (let attempt = 0; attempt < 20 && open + made < RELIEF.openLoads && targets.length; attempt++) {
    const to = pick(targets);
    const from = pick(hubs.filter((h) => h.id !== to.id && h.population >= 100_000 && haversineKm([h.lat, h.lon], [to.lat, to.lon]) <= RELIEF.maxKm));
    if (!from) continue;
    const tons = Math.round((RELIEF.tons[0] + Math.random() * (RELIEF.tons[1] - RELIEF.tons[0])) * 10) / 10;
    const ttl = Math.max(3_600_000, endsAt.getTime() - now.getTime());
    if (await addLoad(db, from.id, to.id, 'pallets', tons, now, ttl, RELIEF.multiplier, { goods: pick(RELIEF.goods), humanitarian: true }, undefined, hubs)) made++;
  }
  return made;
}

/** A relief load arrived on time: ТрансКоин, reputation and (the first time) the badge. */
export async function reliefDelivered(tx: Tx, userId: string, d: { id: string; companyId: string }, contract: { humanitarian: boolean }, late: boolean, at: Date) {
  if (!contract.humanitarian || late || !(await featureFor(tx, userId, 'humanitarian', at))) return;
  await postCoins(tx, userId, { amount: RELIEF.coins, reason: 'humanitarian', description: 'Хуманитарен товар навреме', idempotencyKey: `relief:${d.id}` });
  await tx.update(companies).set({ reputation: sql`least(100, ${companies.reputation} + ${RELIEF.reputation})` }).where(eq(companies.id, d.companyId));
  const [first] = await tx.insert(userBadges).values({ userId, badge: RELIEF.badge, awardedAt: at }).onConflictDoNothing().returning();
  if (first) await notify(tx, userId, 'achievement', `Значка: ${BADGES[RELIEF.badge]?.label ?? ''}`, 'Първият ти хуманитарен товар навреме. Благодарим!', '/game/progress');
}

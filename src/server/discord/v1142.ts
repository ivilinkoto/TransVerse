import { and, avg, count, desc, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import type { Database, DbOrTx } from '@/server/db/client';
import { cities, companies, contracts, deliveryExtras, laneRepeats, tripQueue, users, vehicles } from '@/server/db/schema';
import { alias } from 'drizzle-orm/pg-core';
import { featureLive } from '@/lib/game/features';
import { FOG, foggyAreas } from '@/lib/game/fog';
import { weekKey } from '@/lib/game/leagues';
import { sofiaHourOf } from '@/lib/game/together';
import { t, tx } from '@/i18n/t';
import { appUrl, BRAND } from './config';
import { announce } from './outbox';

/**
 * 1.1.4.2 in Discord: /опашка (the trucks' lined-up trips and repeated
 * lanes), the morning fog report, the mystery client's five stars and the
 * weekly „Най-доволни клиенти“.
 */
export async function queueCommand(db: DbOrTx, userId: string, now = new Date()) {
  if (!featureLive('discord_1142', now)) return { ephemeral: true, content: t('Командата идва със следващото обновление.') };
  const [account] = await db.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
  if (!account) return { ephemeral: true, content: t('Нямаш игрови акаунт.') };
  const origin = alias(cities, 'origin');
  const dest = alias(cities, 'dest');
  const queued = await db
    .select({ plate: vehicles.plate, nickname: vehicles.nickname, from: origin.nameBg, to: dest.nameBg, goods: contracts.goods })
    .from(tripQueue)
    .innerJoin(vehicles, eq(vehicles.id, tripQueue.vehicleId))
    .innerJoin(contracts, eq(contracts.id, tripQueue.contractId))
    .innerJoin(origin, eq(origin.id, contracts.originCityId))
    .innerJoin(dest, eq(dest.id, contracts.destCityId))
    .where(eq(tripQueue.companyId, account.id))
    .orderBy(vehicles.plate, tripQueue.position, tripQueue.createdAt);
  const lanes = await db
    .select({ plate: vehicles.plate, nickname: vehicles.nickname, a: origin.nameBg, b: dest.nameBg, trips: laneRepeats.trips })
    .from(laneRepeats)
    .innerJoin(vehicles, eq(vehicles.id, laneRepeats.vehicleId))
    .innerJoin(origin, eq(origin.id, laneRepeats.aCityId))
    .innerJoin(dest, eq(dest.id, laneRepeats.bCityId))
    .where(eq(laneRepeats.companyId, account.id));
  if (!queued.length && !lanes.length) return { ephemeral: true, content: t('Опашката е празна. Сложи товар след курс от „Поръчки“ в играта: {0}/game/contracts', appUrl()) };
  const lines = [
    ...queued.map((q) => t('▶ **{0}**: {1} → {2} · {3}', q.nickname ? tx(q.nickname) : q.plate, tx(q.from), tx(q.to), tx(q.goods))),
    ...lanes.map((l) => t('🔁 **{0}**: {1} ↔ {2} · {3} курса', l.nickname ? tx(l.nickname) : l.plate, tx(l.a), tx(l.b), l.trips)),
  ];
  return { ephemeral: true, embeds: [{ title: t('Опашката на камионите'), color: BRAND, description: lines.slice(0, 25).join('\n'), url: `${appUrl()}/game/fleet` }] };
}

/** Worker: from 7:00 in November, the day's foggy areas in #ивенти (once a day). */
export async function fogMorning(db: Database, now = new Date()) {
  if (!featureLive('discord_1142', now) || !featureLive('fog', now) || sofiaHourOf(now) < 7) return false;
  const areas = foggyAreas(now);
  if (!areas.length) return false;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(now);
  await announce(db, `fog:${day}`, 'events', () => ({
    embeds: [{ title: t('🌫 Мъгла тази сутрин'), color: 0x94a3b8, description: t('{0}\nТовари от и до мъгливите места плащат **+{1}%** днес. Пет курса през ноември — значка „Пилот в мъглата“.', areas.map((a) => `• ${tx(a.label)}`).join('\n'), Math.round(FOG.payShare * 100)), url: `${appUrl()}/game/contracts` }],
  }), now);
  return true;
}

/** After a trip: five stars from the mystery client go to #класации. */
export async function announceMystery(db: DbOrTx, userId: string, deliveryId: string, now: Date) {
  if (!featureLive('discord_1142', now)) return;
  const [u] = await db.select({ username: users.username }).from(users).where(eq(users.id, userId));
  if (!u) return;
  await announce(db, `mystery:${deliveryId}`, 'rankings', () => ({ embeds: [{ title: t('🕵 Тайният клиент даде пет звезди'), color: BRAND, description: t('**{0}** мина тайната проверка с перфектна доставка.', u.username) }] }), now);
}

/** Worker (Monday): last week's happiest clients — the best average of 5+ reviewed trips. */
export async function happiestClients(db: Database, now = new Date()) {
  if (!featureLive('discord_1142', now)) return 0;
  const week = weekKey(now);
  const start = new Date(`${week.slice(1)}T00:00:00+02:00`);
  const from = new Date(start.getTime() - 7 * 86_400_000);
  const rows = await db
    .select({ username: users.username, avg: avg(deliveryExtras.stars), n: count() })
    .from(deliveryExtras)
    .innerJoin(users, eq(users.id, deliveryExtras.userId))
    .where(and(isNotNull(deliveryExtras.stars), gte(deliveryExtras.createdAt, from), lt(deliveryExtras.createdAt, start)))
    .groupBy(users.username)
    .having(sql`count(*) >= 5`)
    .orderBy(desc(avg(deliveryExtras.stars)), desc(count()))
    .limit(10);
  if (!rows.length) return 0;
  await announce(db, `happiest:${week}`, 'rankings', () => ({
    embeds: [{ title: t('⭐ Най-доволни клиенти — миналата седмица'), color: BRAND, description: rows.map((r, i) => t('{0}. **{1}** — {2} ★ ({3} курса)', i + 1, r.username, Number(r.avg).toFixed(1), r.n)).join('\n') }],
  }), now);
  return rows.length;
}

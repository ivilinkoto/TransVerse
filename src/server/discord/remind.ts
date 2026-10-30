import { and, eq, inArray, like } from 'drizzle-orm';
import type { Database, DbOrTx } from '@/server/db/client';
import { cities, companies, contracts, deliveries, jobState, vehicles } from '@/server/db/schema';
import { featureLive } from '@/lib/game/features';
import { t, tx } from '@/i18n/t';
import { appUrl, BRAND } from './config';
import { enqueue } from './outbox';
import { button, linkButton, rows, STYLE } from './ui';

/**
 * 1.1.3.5 /напомни: a private message from the bot when a truck on a trip
 * arrives (all trucks on the road, or the one named by plate or name).
 */
const PREFIX = 'discord-remind:';
const KEEP_MS = 3 * 86_400_000;

interface Reminder {
  discordId: string;
  vehicleId: string;
  plate: string;
  at: number;
}

export async function remindCommand(db: DbOrTx, userId: string, discordId: string, truck: string | null, now = new Date()) {
  if (!featureLive('discord_remind', now)) return { ephemeral: true, content: t('Командата идва със следващото обновление.') };
  const [account] = await db.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
  if (!account) return { ephemeral: true, content: t('Нямаш игрови акаунт.') };
  const onRoad = await db
    .select({ id: deliveries.id, vehicleId: vehicles.id, plate: vehicles.plate, nickname: vehicles.nickname, etaAt: deliveries.etaAt, dest: cities.nameBg })
    .from(deliveries)
    .innerJoin(vehicles, eq(vehicles.id, deliveries.vehicleId))
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .innerJoin(cities, eq(cities.id, contracts.destCityId))
    .where(and(eq(deliveries.companyId, account.id), eq(deliveries.status, 'in_progress')));
  const q = truck?.trim().toLowerCase().replace(/\s+/g, '');
  const picked = q ? onRoad.filter((d) => d.plate.toLowerCase().replace(/\s+/g, '').includes(q) || d.nickname?.toLowerCase().includes(q)) : onRoad;
  if (!onRoad.length) return { ephemeral: true, content: t('Нямаш камион на курс — пусни един с `/курс` и после пак `/напомни`.') };
  if (!picked.length) return { ephemeral: true, content: t('Нямаш камион на курс с „{0}“ в номера или името.', truck ?? '') };
  for (const d of picked.slice(0, 10)) {
    const value: Reminder = { discordId, vehicleId: d.vehicleId, plate: d.nickname ?? d.plate, at: now.getTime() };
    await db.insert(jobState).values({ key: `${PREFIX}${d.id}`, value }).onConflictDoUpdate({ target: jobState.key, set: { value, updatedAt: now } });
  }
  const lines = picked.slice(0, 10).map((d) => t('🔔 **{0}** → {1}{2}', d.nickname ? tx(d.nickname) : d.plate, tx(d.dest), d.etaAt ? t(' · <t:{0}:R>', Math.floor(d.etaAt.getTime() / 1000)) : ''));
  return { ephemeral: true, embeds: [{ title: t('Ще ти пиша, когато пристигнат'), color: BRAND, description: lines.join('\n'), footer: { text: t('Лично съобщение · спазва тихите ти часове') } }] };
}

/** Worker (every minute): the trucks that arrived get their message; old or lost reminders go. */
export async function sendArrivalReminders(db: Database, now = new Date()) {
  const waiting = await db.select({ key: jobState.key, value: jobState.value }).from(jobState).where(like(jobState.key, `${PREFIX}%`));
  if (!waiting.length) return 0;
  const ids = waiting.map((w) => w.key.slice(PREFIX.length));
  const trips = await db
    .select({ id: deliveries.id, status: deliveries.status, destId: contracts.destCityId, dest: cities.nameBg })
    .from(deliveries)
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .innerJoin(cities, eq(cities.id, contracts.destCityId))
    .where(inArray(deliveries.id, ids));
  const byId = new Map(trips.map((d) => [d.id, d]));
  let sent = 0;
  for (const w of waiting) {
    const id = w.key.slice(PREFIX.length);
    const r = w.value as Reminder;
    const trip = byId.get(id);
    if (trip?.status === 'completed') {
      await enqueue(db, `remind:${id}`, `dm:${r.discordId}`, {
        content: t('🏁 **{0}** пристигна в {1}. Готов за нов курс!', tx(r.plate), tx(trip.dest)),
        components: rows(button(t('Нов курс'), `course:truck:${r.vehicleId}`, STYLE.success, '🚚'), linkButton(t('Товари от {0}', tx(trip.dest)), `${appUrl()}/game/contracts?from=${trip.destId}&truck=${r.vehicleId}`, '📦')),
      }, now);
      sent++;
    } else if (trip && now.getTime() - r.at < KEEP_MS) continue;
    await db.delete(jobState).where(eq(jobState.key, w.key));
  }
  return sent;
}

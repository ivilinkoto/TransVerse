import { and, eq, gt, inArray, isNull, lte } from 'drizzle-orm';
import { money } from '@/lib/format';
import { featureLive } from '@/lib/game/features';
import { RALLY } from '@/lib/game/rally';
import { BATTLE_RULES } from '@/lib/game/battles';
import type { Database } from '@/server/db/client';
import { companyBattles, globalEvents, jobState } from '@/server/db/schema';
import { activeRally } from '@/server/game/rally';
import { discord } from './api';
import { appUrl, discordConfig } from './config';
import { announce } from './outbox';
import { t } from '@/i18n/t';

/**
 * Discord scheduled events (v1.4): the weekly rally, the company battles of
 * the week and the global events show up in the server's "Събития" list
 * (with "Интересува ме" and a reminder from Discord itself). One Discord
 * event per game item, remembered in job_state.
 */

export interface ScheduledItem {
  key: string;
  name: string;
  description: string;
  startsAt: Date;
  endsAt: Date;
}

/** What should be in Discord's event list now. */
export async function scheduledItems(db: Database, now: Date): Promise<ScheduledItem[]> {
  const items: ScheduledItem[] = [];
  const rally = await activeRally(db);
  if (rally && rally.endsAt > now) {
    items.push({ key: `rally:${rally.id}`, name: t('🏁 Рали: {0} → {1}', rally.from, rally.to), description: t('Седмичното рали — {0} км. Най-бързите и най-икономичните трима печелят до {1} и {2} TC. Записване: {3}/game/rally', Math.round(rally.distanceKm), money(RALLY.prizes[0].cents), RALLY.prizes[0].coins, appUrl()), startsAt: rally.startsAt, endsAt: rally.endsAt });
  }
  const [battle] = await db.select({ weekKey: companyBattles.weekKey, endsAt: companyBattles.endsAt, createdAt: companyBattles.createdAt }).from(companyBattles).where(and(eq(companyBattles.status, 'active'), gt(companyBattles.endsAt, now))).limit(1);
  if (battle) {
    items.push({ key: `battles:${battle.weekKey}`, name: t('⚔️ Битка на компаниите'), description: t('Компаниите се борят по двойки: всеки превозен тон се брои. Победителят взема {0} за касата. {1}/game/company/missions', money(BATTLE_RULES.rewardCents), appUrl()), startsAt: battle.createdAt, endsAt: battle.endsAt });
  }
  const events = await db.select().from(globalEvents).where(and(isNull(globalEvents.settledAt), gt(globalEvents.endsAt, now), lte(globalEvents.startsAt, new Date(now.getTime() + 7 * 86_400_000)))).limit(5);
  for (const e of events) items.push({ key: `event:${e.id}`, name: `🌍 ${e.name}`, description: `${e.description}\n${appUrl()}/game/events`.trim().slice(0, 1000), startsAt: e.startsAt, endsAt: e.endsAt });
  return items;
}

/** Worker: creates the missing Discord events (and forgets the ended ones). */
export async function syncScheduledEvents(db: Database, now = new Date()) {
  const cfg = discordConfig();
  if (!cfg.bot || !featureLive('discord_events', now)) return 0;
  const items = await scheduledItems(db, now);
  const keys = items.map((i) => `dsevent:${i.key}`);
  const known = keys.length ? await db.select({ key: jobState.key }).from(jobState).where(inArray(jobState.key, keys)) : [];
  let created = 0;
  for (const item of items) {
    const key = `dsevent:${item.key}`;
    if (known.some((k) => k.key === key)) continue;
    // Discord wants a start in the future: a running item starts "now".
    const start = new Date(Math.max(item.startsAt.getTime(), now.getTime() + 2 * 60_000));
    if (item.endsAt <= start) continue;
    const ev = await discord<{ id: string }>('POST', `/guilds/${cfg.guildId}/scheduled-events`, {
      name: item.name.slice(0, 100),
      description: item.description.slice(0, 1000),
      privacy_level: 2,
      entity_type: 3,
      entity_metadata: { location: 'TransVerse' },
      scheduled_start_time: start.toISOString(),
      scheduled_end_time: item.endsAt.toISOString(),
    }).catch(() => null);
    if (!ev) continue;
    await db.insert(jobState).values({ key, value: { eventId: ev.id } }).onConflictDoNothing();
    created++;
  }
  return created;
}

/** The new weekly rally in #събития. */
export async function announceRally(db: Database, rallyId: string, now: Date) {
  if (!featureLive('rally', now)) return;
  const rally = await activeRally(db);
  if (!rally || rally.id !== rallyId) return;
  await announce(db, `rally:${rally.id}`, 'events', () => ({
    embeds: [{
      title: t('🏁 Ралито на седмицата: {0} → {1}', rally.from, rally.to),
      url: `${appUrl()}/game/rally`,
      color: 0xf97316,
      description: t('{0} км по истински път, един и същ товар за всички. Мери се времето от товаренето до разтоварването и горивото на 100 км. Първите трима във всяка категория печелят до **{1}** и **{2} TC**. Край <t:{3}:R>.', Math.round(rally.distanceKm), money(RALLY.prizes[0].cents), RALLY.prizes[0].coins, Math.floor(rally.endsAt.getTime() / 1000)),
      footer: { text: t('TransVerse · игрови данни') },
    }],
  }), now);
}

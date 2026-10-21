import { and, eq, gt, or } from 'drizzle-orm';
import { int, money } from '@/lib/format';
import { featureLive } from '@/lib/game/features';
import { CONTAINER_PORTS, SHIP_CALL } from '@/lib/game/ports';
import type { Database } from '@/server/db/client';
import { shipCalls } from '@/server/db/schema';
import { shipCallScores } from '@/server/game/ports';
import { discord } from './api';
import { appUrl, discordConfig } from './config';
import { layoutChannel } from './layout';
import { announce } from './outbox';
import { bar } from './ui';

/**
 * "Кораб пристига" in Discord (v1.4): the announcement when a ship comes in,
 * and one live message per ship in #пристанище with the containers left and
 * the companies hauling the most — edited every ten minutes until it ends.
 */

const portName = (cityId: number) => CONTAINER_PORTS.find((p) => p.cityId === cityId)?.name ?? '';
const footer = { text: 'TransVerse · игрови данни (корабите и товарите са измислени, пристанищата са истински)' };

export async function announceShipCall(db: Database, call: { id: string; ship: string; containers: number; endsAt: Date; portName: string }, now: Date) {
  if (!featureLive('ship_calls', now)) return;
  await announce(db, `ship:${call.id}`, 'events', {
    embeds: [{
      title: `🚢 ${call.ship} пристигна в ${call.portName}`,
      url: `${appUrl()}/game/contracts`,
      color: 0x0ea5e9,
      description: `**${call.containers} контейнера** чакат превоз до <t:${Math.floor(call.endsAt.getTime() / 1000)}:R> — с ${Math.round((SHIP_CALL.multiplier - 1) * 100)} % по-добро заплащане. Компанията, която разкара най-много, взема **${money(SHIP_CALL.prizeCents)}** в касата. Брояч на живо в #пристанище.`,
      footer,
    }],
  }, now);
}

/** Worker: the live message of every running (and just finished) ship call. */
export async function liveShipCalls(db: Database, now = new Date()) {
  if (!discordConfig().bot || !featureLive('ship_calls', now)) return 0;
  const calls = await db.select().from(shipCalls).where(or(eq(shipCalls.status, 'active'), and(eq(shipCalls.status, 'done'), gt(shipCalls.endsAt, new Date(now.getTime() - 12 * 3_600_000)))));
  let n = 0;
  for (const call of calls) {
    const scores = await shipCallScores(db, call.id);
    const done = call.status === 'done';
    const message = {
      embeds: [{
        title: `🚢 ${call.ship} · ${portName(call.portCityId)}${done ? ' — приключи' : ''}`,
        url: `${appUrl()}/game/contracts`,
        color: done ? 0x9aa3b2 : 0x0ea5e9,
        description: `${bar(call.containers ? call.delivered / call.containers : 0, 16)} **${int(call.delivered)} / ${int(call.containers)}** контейнера доставени${done ? '' : `\nКрай <t:${Math.floor(call.endsAt.getTime() / 1000)}:R>`}`,
        fields: scores.length ? [{ name: done ? 'Класиране' : 'Водят', value: scores.slice(0, 8).map((s, i) => `${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`} ${s.tag ? `[${s.tag}] ` : ''}${s.name} · ${s.containers}`).join('\n') }] : [],
        footer,
      }],
      allowed_mentions: { parse: [] },
    };
    if (call.discordChannelId && call.discordMessageId) {
      await discord('PATCH', `/channels/${call.discordChannelId}/messages/${call.discordMessageId}`, message).catch(() => undefined);
    } else if (!done) {
      const channelId = await layoutChannel(db, 'пристанище');
      if (!channelId) continue;
      const msg = await discord<{ id: string }>('POST', `/channels/${channelId}/messages`, message);
      await db.update(shipCalls).set({ discordChannelId: channelId, discordMessageId: msg.id }).where(eq(shipCalls.id, call.id));
    }
    n++;
  }
  return n;
}

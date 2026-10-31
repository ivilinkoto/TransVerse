import { eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Database } from '@/server/db/client';
import { featureLive } from '@/lib/game/features';
import { dec, km, money } from '@/lib/format';
import { companies, jobState, users } from '@/server/db/schema';
import { fleetView, leaderboard } from '@/server/game/queries';
import { welcomeBack } from '@/server/game/welcome-back';
import { openContracts } from '@/server/game/contracts';
import { t } from '@/i18n/t';
import { act, answer, released, stop, type Answer, type Ctx } from './context';
import { discord, DiscordError, noPings } from './api';
import { appUrl, BRAND, DISCORD_CHANNELS, discordConfig } from './config';
import { pinPosted, postIn, removePosted, type Posted } from './guild';
import { layoutChannel } from './layout';
import { enqueue } from './outbox';
import { button, linkButton, reply, rows, select, STYLE, update } from './ui';

/**
 * 1.1.4.1 (`discord_game_menu`): /игра — the game in one message of buttons
 * instead of commands to remember; /старт — the first steps for a newcomer;
 * „Планирай следващ“ — a load lined up for a truck on the road.
 */
const live = (ctx: Ctx) => featureLive('discord_game_menu', ctx.now);
const soon = () => answer(reply({ content: t('Това идва със следващото обновление.') }, true));

export async function gameMenu(ctx: Ctx): Promise<Answer> {
  if (!live(ctx)) return soon();
  if (!ctx.me) return startView(ctx);
  return answer(reply({
    embeds: [{ title: t('🚚 TransVerse'), color: BRAND, description: t('Какво ще правим?') }],
    components: rows(
      button(t('Нов курс'), 'menu:course', STYLE.success, '🚚'),
      button(t('Камиони'), 'menu:trucks', STYLE.secondary, '🚛'),
      button(t('Мисии'), 'menu:missions', STYLE.secondary, '📋'),
      button(t('Дневна награда'), 'daily', STYLE.secondary, '🎁'),
      linkButton(t('Играй'), `${appUrl()}/game`, '🎮'),
    ),
  }, true));
}

/** /старт: link the account, pick roles, take the first trip — with what is already done ticked. */
export async function startView(ctx: Ctx): Promise<Answer> {
  if (!live(ctx)) return soon();
  const linked = !!ctx.me;
  const roles = await layoutChannel(ctx.db, 'роли');
  const lines = [
    `${linked ? '✅' : '1️⃣'} ${t('Свържи Discord с играта — ботът ще ти казва кога пристига камионът.')}`,
    `${(ctx.i.member?.roles?.length ?? 0) > 0 ? '✅' : '2️⃣'} ${t('Избери известията си в {0}.', roles ? `<#${roles}>` : '#роли')}`,
    `3️⃣ ${t('Пусни камион на курс — от играта или с бутона тук.')}`,
  ];
  return answer(reply({
    embeds: [{ title: t('👋 Добре дошъл в TransVerse'), color: BRAND, description: lines.join('\n') }],
    components: rows(
      ...(linked ? [button(t('Нов курс'), 'menu:course', STYLE.success, '🚚')] : [linkButton(t('Свържи акаунта'), `${appUrl()}/game/settings#discord`, '🔗')]),
      linkButton(t('Играй'), `${appUrl()}/game`, '🎮'),
    ),
  }, true));
}

/** „Планирай следващ“: the loads from where the truck is going, to line one up after its trip. */
export async function planNext(ctx: Ctx, vehicleId: string): Promise<Answer> {
  const me = released(ctx);
  const [c] = await ctx.db.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, me.id));
  if (!c) stop(t('Нямаш игрови акаунт.'));
  const fleet = await fleetView(ctx.db, c!.id);
  const v = fleet.vehicles.find((x) => x.id === vehicleId);
  if (!v?.delivery) stop(t('Камионът не е на курс — пусни го направо с „Нов курс“.'));
  const loads = (await openContracts(ctx.db, { originCityId: v!.delivery!.destination.id, limit: 30 }, ctx.now)).filter((x) => !x.urgent).slice(0, 10);
  if (!loads.length) stop(t('Няма товари от {0} в момента — опитай пак по-късно.', v!.delivery!.destination.nameBg));
  return answer(reply({
    content: t('📍 **{0}** пристига в {1}. Какво да вземе после?', v!.plate, v!.delivery!.destination.nameBg),
    components: rows(select(`plan:pick:${v!.id}`, loads.map((l) => ({ label: `${l.goods} → ${l.destination.nameBg}`.slice(0, 100), value: l.id, description: t('{0} т · {1} · {2}', dec(l.weightTons), km(l.distanceKm), money(l.rewardCents)), emoji: { name: '📦' } })), t('Избери следващия товар'))),
  }, true));
}

export async function planPick(ctx: Ctx, vehicleId: string, contractId: string): Promise<Answer> {
  const r = await act<{ position: number }>(ctx, { type: 'queueTrip', vehicleId, contractId });
  return answer(update({ content: t('✅ В опашката ({0}). Щом камионът пристигне, тръгва сам.', r.position), components: [] }));
}

/** The menu's own buttons ("Нов курс" and "Мисии" open the existing views). */
export async function menuButton(ctx: Ctx, what: string): Promise<Answer | null> {
  if (what === 'trucks') {
    const me = released(ctx);
    const [c] = await ctx.db.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, me.id));
    if (!c) stop(t('Нямаш игрови акаунт.'));
    const fleet = await fleetView(ctx.db, c!.id);
    const onTrip = fleet.vehicles.filter((v) => v.delivery).slice(0, 5);
    const lines = fleet.vehicles.slice(0, 15).map((v) => (v.delivery ? t('🚚 **{0}** → {1}', v.plate, v.delivery.destination.nameBg) : t('🅿️ **{0}** в {1}', v.plate, v.city.nameBg)));
    const plan = featureLive('trip_queue', ctx.now) ? onTrip.map((v) => button(t('Планирай: {0}', v.plate).slice(0, 80), `plan:truck:${v.id}`, STYLE.secondary, '➕')) : [];
    return answer(reply({ embeds: [{ title: t('Твоите камиони'), color: BRAND, description: lines.join('\n') || t('Нямаш камиони.') }], components: plan.length ? rows(...plan) : [] }, true));
  }
  return null;
}

/** 1.1.4.1: the day in one private message (opt-in, Settings → Discord), from 19:00 Sofia, once a day. */
export async function dailyDigest(db: Database, now = new Date()) {
  if (!featureLive('discord_game_menu', now)) return 0;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', hour: '2-digit', hourCycle: 'h23' }).format(now));
  if (hour < 19) return 0;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(now);
  const people = await db
    .select({ id: users.id, discordId: users.discordId, companyId: companies.id })
    .from(users)
    .innerJoin(companies, eq(companies.ownerId, users.id))
    .where(sql`${isNotNull(users.discordId)} and ${isNull(users.bannedAt)} and (${users.discordPrefs} ->> 'digest') = 'true'`);
  let sent = 0;
  for (const p of people) {
    // The last 24 hours, like "Докато те нямаше".
    const s = await welcomeBack(db, p.companyId, p.id, new Date(now.getTime() - 24 * 3_600_000), now);
    if (!s || !p.discordId) continue;
    await enqueue(db, `digest:${p.id}:${day}`, `dm:${p.discordId}`, {
      embeds: [{ title: t('🌙 Денят ти в TransVerse'), color: BRAND, description: [t('🚚 Курсове: **{0}**', s.trips), t('💰 Изкарани: **{0}** · нето {1}', money(s.earnedCents), money(s.netCents)), s.idleTrucks ? t('🅿️ Чакат курс: **{0}**', s.idleTrucks) : t('✅ Всички камиони са на път')].join('\n') }],
      components: rows(button(t('Нов курс'), 'menu:course', STYLE.success, '🚚'), linkButton(t('Играй'), `${appUrl()}/game`, '🎮')),
    }, now);
    sent++;
  }
  return sent;
}

// ── The live ranking in #класации ──────────────────────────────────────────

const LIVE_KEY = 'discord-live-ranking';
const medal = (i: number) => ['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`;

/** One message in #класации edited every 10 minutes (instead of a new message each time). */
export async function liveRanking(db: Database, now = new Date()): Promise<'posted' | 'updated' | 'off'> {
  if (!discordConfig().bot || !featureLive('discord_game_menu', now)) return 'off';
  const { rows: top, season } = await leaderboard(db, 'season', 10);
  const message = {
    ...noPings,
    embeds: [{
      title: t('🏆 Класация на живо{0}', season ? ` · ${season.name}` : ''),
      url: `${appUrl()}/game/leaderboards`,
      color: BRAND,
      description: top.map((r, i) => `${medal(i)} **${r.owner}** · ${t('{0} т.', Number(r.value).toLocaleString('bg-BG'))}`).join('\n') || t('Още няма класирани.'),
      footer: { text: t('Обновява се на 10 минути · игрови данни') },
      timestamp: now.toISOString(),
    }],
  };
  const [row] = await db.select().from(jobState).where(eq(jobState.key, LIVE_KEY));
  const state = (row?.value ?? null) as Posted | null;
  const save = (v: Posted) => db.insert(jobState).values({ key: LIVE_KEY, value: v }).onConflictDoUpdate({ target: jobState.key, set: { value: v, updatedAt: now } });
  if (state) {
    try {
      await discord('PATCH', `/channels/${state.channelId}/messages/${state.messageId}`, message);
      return 'updated';
    } catch (e) {
      if (!(e instanceof DiscordError) || e.status === 429 || e.status >= 500) throw e;
      await removePosted(state).catch(() => undefined);
    }
  }
  const channelId = await layoutChannel(db, DISCORD_CHANNELS.rankings);
  if (!channelId) return 'off';
  const posted = await postIn(channelId, message);
  await pinPosted(posted);
  await save(posted);
  return 'posted';
}

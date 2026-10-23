import { eq } from 'drizzle-orm';
import { dec, int, km, money } from '@/lib/format';
import { dailyState, DAILY_REWARDS } from '@/lib/game/daily';
import { EVENT_METRIC_INFO, type EventMetric } from '@/lib/game/events';
import { combinationCapability } from '@/lib/game/catalog';
import { canSplit, partRewardCents, partTons } from '@/lib/game/partial';
import { featureFor } from '@/server/features';
import { companies } from '@/server/db/schema';
import { currentBattle } from '@/server/game/battles';
import { ensureLocalJobsForFleet, openContracts } from '@/server/game/contracts';
import { compatibilityError } from '@/server/game/deliveries';
import { runningEvents } from '@/server/game/events';
import { membershipOf } from '@/server/game/membership';
import { fleetView } from '@/server/game/queries';
import { act, answer, released, stop, type Answer, type Ctx } from './context';
import { appUrl } from './config';
import { bar, button, linkButton, reply, rows, select, STYLE, update, type MessageData } from './ui';

/**
 * The game in Discord: /курс (a truck and a load from menus), "Нов курс"
 * under a delivery notification, the daily reward with a button, /ивент and
 * /битка. Every change goes through runAction as the linked player.
 */

const footer = { text: 'TransVerse · игрови данни' };
const at = (d: Date | string) => `<t:${Math.floor(new Date(d).getTime() / 1000)}:R>`;

async function account(ctx: Ctx) {
  const me = released(ctx);
  const [c] = await ctx.db.select().from(companies).where(eq(companies.ownerId, me.id));
  if (!c) stop('Нямаш игрови акаунт.');
  return { me, company: c! };
}

/** /курс: which truck? */
export async function courseStart(ctx: Ctx): Promise<Answer> {
  const { company } = await account(ctx);
  const fleet = await fleetView(ctx.db, company.id);
  const free = fleet.vehicles.filter((v) => !v.delivery && v.status === 'idle');
  if (!free.length) {
    const busy = fleet.vehicles.filter((v) => v.delivery?.etaAt).map((v) => `🚚 **${v.plate}** → ${v.delivery!.destination.nameBg} · пристига ${at(v.delivery!.etaAt!)}`);
    return answer(reply({ content: busy.length ? `Всички камиони са на път:\n${busy.slice(0, 10).join('\n')}` : 'Нямаш свободен камион с шофьор.' }, true));
  }
  if (free.length === 1) return answer(await truckLoads(ctx, free[0]!.id, 'reply'));
  return answer(reply({
    content: '🚚 Кой камион тръгва?',
    components: rows(select('course:truck', free.slice(0, 25).map((v) => ({ label: `${v.plate} · ${v.model.name}`, value: v.id, description: `в ${v.city.nameBg} · ${Math.round(v.condition)} %${v.driver ? '' : ' · без шофьор'}`, emoji: { name: '🚚' } })), 'Избери камион')),
  }, true));
}

/** The best loads this truck can take from where it stands. */
export async function truckLoads(ctx: Ctx, vehicleId: string, how: 'reply' | 'update') {
  const { me, company } = await account(ctx);
  await ensureLocalJobsForFleet(ctx.db, ctx.now, company.id).catch(() => undefined);
  const fleet = await fleetView(ctx.db, company.id);
  const v = fleet.vehicles.find((x) => x.id === vehicleId);
  if (!v) stop('Този камион вече не е твой.');
  if (v!.delivery) stop(`**${v!.plate}** е на път към ${v!.delivery.destination.nameBg} — пристига ${v!.delivery.etaAt ? at(v!.delivery.etaAt) : 'скоро'}.`);
  const member = await membershipOf(ctx.db, me.id);
  const loads = await openContracts(ctx.db, { originCityId: v!.cityId, limit: 80, memberOfCompanyId: member?.company.id ?? null }, ctx.now);
  const bundle = { modelId: v!.modelId, trailerModelId: v!.trailer?.modelId ?? null, condition: v!.condition, hasDriver: !!v!.driver, status: v!.status, trailerCondition: v!.trailer?.condition ?? null };
  // Loads bigger than the truck: only the part it carries (v1.3), for the share of the pay.
  const payload = combinationCapability({ unit: v!.model, trailer: v!.trailer?.model ?? null }).payloadTons;
  const partial = await featureFor(ctx.db, me.id, 'partial_loads', ctx.now);
  const ok = loads
    .map((c) => {
      if (compatibilityError(bundle, c, me.level) === null) return { c, tons: null };
      const tons = partial && canSplit(c) ? partTons(c.weightTons, payload) : null;
      return tons && compatibilityError(bundle, { ...c, weightTons: tons }, me.level) === null ? { c, tons } : null;
    })
    .filter((x) => x !== null)
    .slice(0, 10);
  const data: MessageData = ok.length
    ? {
        content: `📦 Товари за **${v!.plate}** от ${v!.city.nameBg}:`,
        components: rows(select(`course:pick:${v!.id}`, ok.map(({ c, tons }) => ({ label: `${c.goods} → ${c.destination.nameBg}`.slice(0, 100), value: tons ? `${c.id}:${tons}` : c.id, description: tons ? `${dec(tons)} от ${dec(c.weightTons)} т · ${km(c.distanceKm)} · ${money(partRewardCents(c, tons))}` : `${dec(c.weightTons)} т · ${km(c.distanceKm)} · ${money(c.rewardCents)}${c.urgent ? ' · спешна' : ''}`, emoji: { name: c.urgent ? '⚡' : tons ? '✂️' : '📦' } })), 'Избери товар'), linkButton('Всички поръчки', `${appUrl()}/game/contracts?from=${v!.cityId}&truck=${v!.id}`, '🗺️')),
      }
    : { content: `Няма товар, който **${v!.plate}** може да вземе от ${v!.city.nameBg} в момента.`, components: rows(linkButton('Виж поръчките', `${appUrl()}/game/contracts`, '🗺️')) };
  return how === 'update' ? update(data) : reply(data, true);
}

/** The load is picked: the truck goes (same as "Поеми" in the game). */
export async function courseGo(ctx: Ctx, vehicleId: string, pick: string): Promise<Answer> {
  // "<contract>" for the whole load, "<contract>:<tons>" for a part of it.
  const [contractId = '', part] = pick.split(':');
  const r = await act<{ etaAt: string | Date }>(ctx, { type: 'acceptContract', contractId, vehicleId, rush: false, overload: false, insure: false, route: 'fast', parking: 'free', refuel: false, ...(part ? { tons: Number(part) } : {}) });
  return answer(update({ content: `✅ Камионът тръгна! Пристига ${at(r.etaAt)}. Ще ти пишем, когато стигне.`, components: rows(linkButton('Виж на картата', `${appUrl()}/game/map`, '🗺️')) }));
}

/** /дневна: the state, with "Вземи" when it waits. */
export function dailyView(ctx: Ctx): Answer {
  const me = released(ctx);
  const s = dailyState(me.loginStreak, me.dailyClaimKey, ctx.now);
  if (s.claimedToday) return answer(reply({ content: `✅ Днешната награда е взета. Серия: **${s.streak}** дни. Ела утре за ден ${(s.cycleDay % DAILY_REWARDS.length) + 1}!` }, true));
  return answer(reply({
    content: `🎁 Наградата за днес те чака — ден ${s.cycleDay}: **${money(s.reward.cents)}**${s.reward.coins ? ` + ${s.reward.coins} ТрансКоин` : ''}. Серия: ${s.streak} дни.`,
    components: rows(button('Вземи наградата', 'daily:claim', STYLE.success, '🎁')),
  }, true));
}

export async function dailyClaim(ctx: Ctx): Promise<Answer> {
  const r = await act<{ cents: number; coins?: number; streak: number }>(ctx, { type: 'claimDaily' });
  return answer(update({ content: `🎉 Взе **${money(r.cents)}**${r.coins ? ` + ${r.coins} ТрансКоин` : ''}! Серия: **${r.streak}** дни.` }));
}

/** /ивент: the running community events and the player's part. */
export async function eventView(ctx: Ctx): Promise<Answer> {
  const me = released(ctx);
  const list = await runningEvents(ctx.db, me.id, ctx.now);
  if (!list.length) return answer(reply({ content: 'В момента няма ивент. Следи #ивенти!' }, true));
  const fmt = (metric: string, v: number) => (metric === 'earned_cents' ? money(v) : `${int(Math.round(v))} ${EVENT_METRIC_INFO[metric as EventMetric]?.unit ?? ''}`);
  return answer(reply({
    embeds: list.map(({ event: e, mine }) => ({
      title: `🎯 ${e.name}`,
      url: `${appUrl()}/game/events`,
      color: 0x22d3ee,
      description: `${e.description.slice(0, 300)}\n\n${bar(e.progress / e.target)}\n${fmt(e.metric, e.progress)} от ${fmt(e.metric, e.target)}`,
      fields: [
        { name: 'Твоят принос', value: mine >= e.minContribution ? `${fmt(e.metric, mine)} ✅` : `${fmt(e.metric, mine)} (нужни са поне ${fmt(e.metric, e.minContribution)})`, inline: true },
        { name: 'Край', value: at(e.endsAt), inline: true },
      ],
      footer,
    })),
  }, true));
}

/** /битка: this week's battle of the player's company. */
export async function battleView(ctx: Ctx): Promise<Answer> {
  const me = released(ctx);
  const m = await membershipOf(ctx.db, me.id);
  if (!m) stop('Не членуваш в компания.');
  const b = await currentBattle(ctx.db, m!.company.id, ctx.now);
  if (!b || !b.rival) return answer(reply({ content: 'Тази седмица компанията ти няма битка (двойките се правят в понеделник).' }, true));
  const total = b.ourTons + b.theirTons;
  const lead = b.ourTons === b.theirTons ? '🤝 Равенство' : b.ourTons > b.theirTons ? '🟢 Водите' : '🔴 Изоставате';
  return answer(reply({
    embeds: [{
      title: `⚔️ ${m!.company.name} срещу ${b.rival.name}`,
      url: `${appUrl()}/game/company/missions`,
      color: 0xe04545,
      description: `${lead}\n\n**${dec(b.ourTons)} т** ${bar(total ? b.ourTons / total : 0.5, 12)} **${dec(b.theirTons)} т**`,
      fields: [{ name: 'Край', value: at(b.endsAt), inline: true }],
      footer: { text: 'Броят се тоновете на членовете до неделя 24:00 · игрови данни' },
    }],
  }, true));
}

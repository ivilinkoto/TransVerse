import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { dec, int, km, money } from '@/lib/format';
import { combinationCapability } from '@/lib/game/catalog';
import { featureLive } from '@/lib/game/features';
import { canSplit, partRewardCents, partTons } from '@/lib/game/partial';
import { PASS_POINTS_PER_LEVEL, PASS_LEVELS } from '@/lib/game/season-pass';
import { DUEL } from '@/lib/game/together';
import { ROADSIDE } from '@/lib/game/roadside';
import type { Database } from '@/server/db/client';
import { cities, companies, companyBattles, contracts, jobState, liveryEntries, openConvoys, organizations, users } from '@/server/db/schema';
import { companyAnalytics } from '@/server/game/analytics';
import { periodWindow } from '@/lib/game/missions';
import { compatibilityError } from '@/server/game/deliveries';
import { featureFor } from '@/server/features';
import { duelsOf } from '@/server/game/together';
import { openContracts } from '@/server/game/contracts';
import { membershipOf } from '@/server/game/membership';
import { fleetView } from '@/server/game/queries';
import { passView } from '@/server/game/season-pass';
import { discord } from './api';
import { mapCardToken } from './map-token';
import { act, answer, opt, released, stop, type Answer, type Ctx } from './context';
import { appUrl, BRAND, discordConfig } from './config';
import { layoutChannel } from './layout';
import { bar, button, linkButton, reply, rows, say, select, STYLE, update } from './ui';

/**
 * The v1.3 "together" features in Discord: take a load (the load of the day,
 * a shared company load, a favourite lane), /конвой, buy from #пазар-камиони,
 * /финанси, /дуел, /пропуск, the choices at a breakdown, the livery 👍 and
 * the live battle board. Every change goes through runAction.
 */

const footer = { text: 'TransVerse · игрови данни' };
const at = (d: Date | string, style = 'R') => `<t:${Math.floor(new Date(d).getTime() / 1000)}:${style}>`;

async function account(ctx: Ctx) {
  const me = released(ctx);
  const [c] = await ctx.db.select().from(companies).where(eq(companies.ownerId, me.id));
  if (!c) stop('Нямаш игрови акаунт.');
  return { me, company: c! };
}

// ── Take a load ──────────────────────────────────────────────────────────

/** "Поеми" / "Вземи част": the player's free trucks that can take this load (whole or the part they carry). */
export async function takeStart(ctx: Ctx, contractId: string): Promise<Answer> {
  const { me, company } = await account(ctx);
  const [c] = await ctx.db.select().from(contracts).where(eq(contracts.id, contractId));
  if (!c || c.status !== 'open' || c.expiresAt <= ctx.now) stop('Този товар вече не е на борсата.');
  const partial = await featureFor(ctx.db, me.id, 'partial_loads', ctx.now);
  const fleet = await fleetView(ctx.db, company.id);
  const options = fleet.vehicles
    .filter((v) => !v.delivery && v.status === 'idle')
    .map((v) => {
      const bundle = { modelId: v.modelId, trailerModelId: v.trailer?.modelId ?? null, condition: v.condition, hasDriver: !!v.driver, status: v.status, trailerCondition: v.trailer?.condition ?? null };
      if (compatibilityError(bundle, c!, me.level) === null) return { v, tons: null };
      const payload = combinationCapability({ unit: v.model, trailer: v.trailer?.model ?? null }).payloadTons;
      const tons = partial && canSplit(c!) ? partTons(c!.weightTons, payload) : null;
      return tons && compatibilityError(bundle, { ...c!, weightTons: tons }, me.level) === null ? { v, tons } : null;
    })
    .filter((x) => x !== null)
    .slice(0, 25);
  if (!options.length) stop('Нямаш свободен камион, който може да вземе този товар (вид надстройка, капацитет, ниво или шофьор).');
  return answer(reply({
    content: `📦 **${c!.goods}** · ${dec(c!.weightTons)} т · ${money(c!.rewardCents)} — с кой камион?`,
    components: rows(select(`take:go:${contractId}`, options.map(({ v, tons }) => ({
      label: `${v.plate} · ${v.model.name}`.slice(0, 100),
      value: tons ? `${v.id}:${tons}` : v.id,
      description: `${v.city.nameBg}${v.cityId === c!.originCityId ? ' · на място' : ''}${tons ? ` · част ${dec(tons)} т за ${money(partRewardCents(c!, tons))}` : ' · целия товар'}`,
      emoji: { name: tons ? '✂️' : '🚚' },
    })), 'Избери камион')),
  }, true));
}

export async function takeGo(ctx: Ctx, contractId: string, pick: string): Promise<Answer> {
  const [vehicleId = '', part] = pick.split(':');
  const r = await act<{ etaAt: string | Date }>(ctx, { type: 'acceptContract', contractId, vehicleId, rush: false, overload: false, ...(part ? { tons: Number(part) } : {}) });
  return answer(update({ content: `✅ Камионът тръгна${part ? ` с ${dec(Number(part))} т` : ''}! Пристига ${at(r.etaAt)}.`, components: rows(linkButton('Виж на картата', `${appUrl()}/game/map`, '🗺️')) }));
}

// ── Convoys ──────────────────────────────────────────────────────────────

/** /конвой: the trip that just left goes to #конвои. */
export async function convoyCommand(ctx: Ctx): Promise<Answer> {
  const r = await act<{ origin: string; destination: string; expiresAt: string | Date }>(ctx, { type: 'announceConvoy' });
  return answer(say(`🚚 Конвоят ${r.origin} → ${r.destination} е обявен в #конвои. Който тръгне по същия път до ${at(r.expiresAt, 't')}, кара с теб.`));
}

/** "Включвам се": the loads on that lane for the player's free trucks. */
export async function convoyJoin(ctx: Ctx, convoyId: string): Promise<Answer> {
  const { me, company } = await account(ctx);
  const [c] = await ctx.db.select().from(openConvoys).where(and(eq(openConvoys.id, convoyId), gt(openConvoys.expiresAt, ctx.now)));
  if (!c) stop('Конвоят вече тръгна — следващия път!');
  if (c!.userId === me.id) stop('Това е твоят конвой. 🙂');
  const member = await membershipOf(ctx.db, me.id);
  const loads = (await openContracts(ctx.db, { originCityId: c!.originCityId, limit: 100, memberOfCompanyId: member?.company.id ?? null }, ctx.now)).filter((l) => l.destCityId === c!.destCityId && !l.urgent);
  const fleet = await fleetView(ctx.db, company.id);
  const free = fleet.vehicles.filter((v) => !v.delivery && v.status === 'idle');
  const picks = free
    .flatMap((v) => {
      const bundle = { modelId: v.modelId, trailerModelId: v.trailer?.modelId ?? null, condition: v.condition, hasDriver: !!v.driver, status: v.status, trailerCondition: v.trailer?.condition ?? null };
      const load = loads.find((l) => compatibilityError(bundle, l, me.level) === null);
      return load ? [{ v, load }] : [];
    })
    .slice(0, 25);
  if (!picks.length) stop(`Няма товар ${loads.length ? 'за твоите свободни камиони ' : ''}по тази линия в момента. Виж борсата: ${appUrl()}/game/contracts?lane=${c!.originCityId}-${c!.destCityId}`);
  return answer(reply({
    content: '🚚 С кой камион и товар тръгваш?',
    components: rows(select(`convoy:go:${convoyId}`, picks.map(({ v, load }) => ({ label: `${v.plate} · ${load.goods}`.slice(0, 100), value: `${v.id}/${load.id}`, description: `${v.city.nameBg} · ${dec(load.weightTons)} т · ${money(load.rewardCents)}`, emoji: { name: '🚚' } })), 'Избери')),
  }, true));
}

export async function convoyGo(ctx: Ctx, pick: string): Promise<Answer> {
  const [vehicleId = '', contractId = ''] = pick.split('/');
  return takeGo(ctx, contractId, vehicleId);
}

// ── Used market ──────────────────────────────────────────────────────────

export async function usedBuy(ctx: Ctx, listingId: string): Promise<Answer> {
  await act(ctx, { type: 'buyListing', listingId });
  // The listing in #пазар-камиони says it is gone (for everyone).
  const buyer = ctx.me?.username ?? ctx.discordName;
  return answer(update({ content: `✅ Продадено на **${buyer}**.`, embeds: (ctx.i.message?.embeds ?? []) as Record<string, unknown>[] }));
}

// ── /финанси ─────────────────────────────────────────────────────────────

export async function financeView(ctx: Ctx): Promise<Answer> {
  const { company } = await account(ctx);
  const a = await companyAnalytics(ctx.db, company.id, 7, ctx.now);
  const best = a.lanes[0];
  const truck = a.vehicles[0];
  return answer(reply({
    embeds: [{
      title: '📊 Финанси · последните 7 дни',
      url: `${appUrl()}/game/analytics`,
      color: a.netCents >= 0 ? 0x2fd27a : 0xe04545,
      fields: [
        { name: 'Нетно', value: money(a.netCents), inline: true },
        { name: 'Възнаграждения', value: money(a.revenueCents), inline: true },
        { name: 'Баланс', value: money(company.balanceCents), inline: true },
        { name: 'Курсове', value: `${a.trips} · ${int(Math.round(a.km))} км · ${int(Math.round(a.tons))} т`, inline: true },
        { name: 'Навреме', value: a.trips ? `${Math.round(a.onTimeShare * 100)} %` : '—', inline: true },
        { name: 'Нетно на км', value: a.km ? money(Math.round(a.netPerKmCents)) : '—', inline: true },
        ...(best ? [{ name: 'Най-добра линия', value: `${a.names.lane[best.key]} · ${money(best.netCents)}`, inline: false }] : []),
        ...(truck ? [{ name: 'Най-добър камион', value: `${a.names.vehicle[truck.key]?.plate ?? '—'} · ${money(truck.netCents)} за ${truck.trips} курса`, inline: false }] : []),
      ],
      footer,
    }],
  }, true));
}

// ── /дуел ────────────────────────────────────────────────────────────────

export async function duelCommand(ctx: Ctx): Promise<Answer> {
  const me = released(ctx);
  const target = opt(ctx.i, 'потребител');
  if (target) {
    const [rival] = await ctx.db.select({ id: users.id, username: users.username }).from(users).where(eq(users.discordId, target));
    if (!rival) stop('Този член не е свързал акаунта си с играта.');
    await act(ctx, { type: 'challengeDuel', userId: rival!.id });
    return answer(reply({ content: `⚔️ Предизвика **${rival!.username}** на дуел: кой ще превози повече тонове за ${DUEL.days} дни. Победителят печели ${DUEL.coins} ТрансКоин.` }, true));
  }
  const list = await duelsOf(ctx.db, me.id);
  if (!list.length) return answer(say(`Нямаш дуели. Предизвикай някого: \`/дуел @потребител\` — ${DUEL.days} дни, повече тонове печели ${DUEL.coins} ТрансКоин.`));
  const line = (d: (typeof list)[number]) =>
    d.status === 'active' ? `⚔️ **${d.rival}** · ${dec(d.myTons)} : ${dec(d.theirTons)} т · край ${d.endsAt ? at(d.endsAt) : ''}`
    : d.status === 'pending' ? `⏳ **${d.rival}** · ${d.incoming ? 'те предизвика' : 'чака отговор'}`
    : d.status === 'done' ? `${d.won === true ? '🏆' : d.won === false ? '✖️' : '🤝'} **${d.rival}** · ${dec(d.myTons)} : ${dec(d.theirTons)} т`
    : `▫️ **${d.rival}** · ${d.status === 'declined' ? 'отказан' : 'изтекъл'}`;
  const incoming = list.filter((d) => d.incoming).slice(0, 2);
  return answer(reply({
    embeds: [{ title: '⚔️ Дуелите ти', color: BRAND, description: list.map(line).join('\n'), footer }],
    components: rows(...incoming.flatMap((d) => [button(`Приеми · ${d.rival}`, `duel:yes:${d.id}`, STYLE.success, '⚔️'), button('Откажи', `duel:no:${d.id}`, STYLE.secondary)])),
  }, true));
}

export async function duelAnswer(ctx: Ctx, duelId: string, accept: boolean): Promise<Answer> {
  await act(ctx, { type: 'respondDuel', duelId, accept });
  return answer(update({ content: accept ? `⚔️ Дуелът започна! ${DUEL.days} дни — всеки тон се брои. Резултатът: \`/дуел\`.` : 'Дуелът е отказан.' }));
}

// ── /пропуск ─────────────────────────────────────────────────────────────

export async function passCommand(ctx: Ctx): Promise<Answer> {
  const me = released(ctx);
  const p = await passView(ctx.db, me.id, ctx.now);
  const into = p.points - p.level * PASS_POINTS_PER_LEVEL;
  return answer(reply({
    embeds: [{
      title: `🎟️ Сезонен пропуск · ${p.season.name}`,
      url: `${appUrl()}/game/pass`,
      color: p.premium ? 0xf6c343 : BRAND,
      description: `Ниво **${p.level}** от ${PASS_LEVELS}${p.premium ? ' · премиум' : ''}\n${p.level >= PASS_LEVELS ? 'Максимално ниво! 🏆' : `${bar(into / PASS_POINTS_PER_LEVEL)} ${int(into)} / ${int(PASS_POINTS_PER_LEVEL)} точки до ниво ${p.level + 1}`}\n\n${p.claimable ? `🎁 **${p.claimable}** ${p.claimable === 1 ? 'награда те чака' : 'награди те чакат'}.` : 'Няма невзети награди.'}`,
      footer,
    }],
    components: p.claimable ? rows(button('Вземи наградите', 'pass:claim', STYLE.success, '🎁')) : [],
  }, true));
}

export async function passClaim(ctx: Ctx): Promise<Answer> {
  await act(ctx, { type: 'claimSeasonPass' });
  return answer(update({ content: `🎁 Наградите са твои! Виж ги в играта: ${appUrl()}/game/pass`, embeds: [] }));
}

// ── At a breakdown ───────────────────────────────────────────────────────

export async function roadPay(ctx: Ctx, deliveryId: string): Promise<Answer> {
  const r = await act<{ savedMs: number }>(ctx, { type: 'roadsidePaid', deliveryId });
  return answer(update({ content: `🛠️ Пътната помощ идва — камионът тръгва ${Math.max(1, Math.round(r.savedMs / 60_000))} мин. по-рано (${money(ROADSIDE.paidCents)}).` }));
}

export async function roadCall(ctx: Ctx, deliveryId: string): Promise<Answer> {
  const r = await act<{ asked: number }>(ctx, { type: 'callForHelp', deliveryId });
  return answer(update({ content: `📣 Повика ${r.asked} ${r.asked === 1 ? 'приятел/колега' : 'приятели и колеги'}. Който е наблизо с камион, може да помогне.` }));
}

export async function roadHelp(ctx: Ctx, deliveryId: string): Promise<Answer> {
  const r = await act<{ savedMs: number; feeCents: number }>(ctx, { type: 'helpOnRoad', deliveryId });
  return answer(update({ content: `🤝 Помогна! Камионът тръгва ${Math.max(1, Math.round(r.savedMs / 60_000))} мин. по-рано. Хонорар ${money(r.feeCents)}.` }));
}

// ── Livery contest ───────────────────────────────────────────────────────

export async function liveryVote(ctx: Ctx, entryId: string): Promise<Answer> {
  const r = await act<{ votes: number }>(ctx, { type: 'voteLivery', entryId });
  return answer(say(`👍 Гласът ти е записан — камионът вече има ${r.votes} 👍.`));
}

/** Worker: new entries of the livery contest go to #ливреи with their picture and a 👍 button. */
export async function postLiveryEntries(db: Database, now = new Date()) {
  if (!discordConfig().bot || !featureLive('livery_contest', now)) return 0;
  const channelId = await layoutChannel(db, 'ливреи');
  if (!channelId) return 0;
  const fresh = await db.select({ e: liveryEntries, username: users.username }).from(liveryEntries).innerJoin(users, eq(users.id, liveryEntries.userId)).where(and(isNull(liveryEntries.messageId), gt(liveryEntries.createdAt, new Date(now.getTime() - 3 * 86_400_000)))).limit(20);
  let n = 0;
  for (const { e, username } of fresh) {
    // Taken first, so two workers do not post it twice.
    const [mine] = await db.update(liveryEntries).set({ messageId: 'posting' }).where(and(eq(liveryEntries.id, e.id), isNull(liveryEntries.messageId))).returning({ id: liveryEntries.id });
    if (!mine) continue;
    const msg = await discord<{ id: string }>('POST', `/channels/${channelId}/messages`, {
      embeds: [{ title: `🎨 ${username} · ${e.plate}`, color: Number.parseInt(e.color.replace('#', ''), 16) || BRAND, image: { url: `${appUrl()}/api/discord/card/livery/${e.id}` }, description: 'Дай 👍, ако ти харесва — най-харесваният камион на месеца печели.', footer }],
      components: rows(button('Харесва ми', `livery:vote:${e.id}`, STYLE.success, '👍')),
      allowed_mentions: { parse: [] },
    }).catch(() => null);
    // A failed post stays marked, so it is not retried every minute.
    await db.update(liveryEntries).set({ messageId: msg?.id ?? 'failed' }).where(eq(liveryEntries.id, e.id));
    if (msg) n++;
  }
  return n;
}

// ── Battles, live ────────────────────────────────────────────────────────

/** Worker: one message in #битки with this week's battles, edited as the tonnes come in. */
export async function liveBattles(db: Database, now = new Date()) {
  if (!discordConfig().bot || !featureLive('discord_bot', now)) return null;
  const week = periodWindow('weekly', now);
  const battles = await db.select().from(companyBattles).where(and(eq(companyBattles.weekKey, week.key), eq(companyBattles.status, 'active')));
  if (!battles.length) return null;
  const ids = [...new Set(battles.flatMap((b) => [b.aId, b.bId]))];
  const names = new Map((await db.select({ id: organizations.id, name: organizations.name, tag: organizations.tag }).from(organizations).where(inArray(organizations.id, ids))).map((o) => [o.id, o.tag ? `[${o.tag}] ${o.name}` : o.name]));
  const top = [...battles].sort((a, b) => b.aTons + b.bTons - (a.aTons + a.bTons)).slice(0, 12);
  const message = {
    embeds: [{
      title: '⚔️ Битките тази седмица — на живо',
      url: `${appUrl()}/game/company/missions`,
      color: 0xe04545,
      description: `Край ${at(week.endsAt)} · обновява се на всеки 10 минути`,
      fields: top.map((b) => {
        const total = b.aTons + b.bTons;
        return { name: `${names.get(b.aId) ?? '—'} vs ${names.get(b.bId) ?? '—'}`.slice(0, 250), value: `**${int(Math.round(b.aTons))}** : **${int(Math.round(b.bTons))}** т\n${bar(total > 0 ? b.aTons / total : 0.5, 16)}`, inline: false };
      }),
      footer: { text: `TransVerse · игрови данни · ${battles.length} битки` },
    }],
    allowed_mentions: { parse: [] },
  };
  const key = `discord-battle-live:${week.key}`;
  const [state] = await db.select().from(jobState).where(eq(jobState.key, key));
  const saved = state?.value as { channelId: string; messageId: string } | undefined;
  if (saved) {
    const ok = await discord('PATCH', `/channels/${saved.channelId}/messages/${saved.messageId}`, message).then(() => true, () => false);
    if (ok) return saved.messageId;
  }
  const channelId = await layoutChannel(db, 'битки');
  if (!channelId) return null;
  const msg = await discord<{ id: string }>('POST', `/channels/${channelId}/messages`, message);
  await db.insert(jobState).values({ key, value: { channelId, messageId: msg.id } }).onConflictDoUpdate({ target: jobState.key, set: { value: { channelId, messageId: msg.id }, updatedAt: now } });
  return msg.id;
}

// ── Load of the day ──────────────────────────────────────────────────────

/** The load of the day's lane names, for its announcement. */
export async function dailyLoadLane(db: Database, contractId: string) {
  const [c] = await db.select().from(contracts).where(eq(contracts.id, contractId));
  if (!c) return null;
  const names = await db.select({ id: cities.id, nameBg: cities.nameBg }).from(cities).where(or(eq(cities.id, c.originCityId), eq(cities.id, c.destCityId)));
  const name = (id: number) => names.find((x) => x.id === id)?.nameBg ?? '';
  return { load: c, lane: { from: name(c.originCityId), to: name(c.destCityId) } };
}

// ── /карта ───────────────────────────────────────────────────────────────

export async function mapCommand(ctx: Ctx): Promise<Answer> {
  const { me, company } = await account(ctx);
  const fleet = await fleetView(ctx.db, company.id);
  if (!fleet.vehicles.length) stop('Нямаш камиони.');
  const moving = fleet.vehicles.filter((v) => v.delivery);
  const lines = fleet.vehicles.slice(0, 12).map((v) => (v.delivery ? `🟠 **${v.plate}** → ${v.delivery.destination.nameBg}${v.delivery.etaAt ? ` · ${at(v.delivery.etaAt)}` : ''}` : `🟢 **${v.plate}** · ${v.city.nameBg}`));
  return answer(reply({
    embeds: [{
      title: `🗺️ Камионите ти · ${moving.length} на път, ${fleet.vehicles.length - moving.length} свободни`,
      url: `${appUrl()}/game/map`,
      color: BRAND,
      description: lines.join('\n'),
      image: { url: `${appUrl()}/api/discord/card/map/${me.id}?k=${mapCardToken(me.id, ctx.now)}&t=${Math.floor(ctx.now.getTime() / 60_000)}` },
      footer,
    }],
  }, true));
}

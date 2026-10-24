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
import { t } from '@/i18n/t';

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
  if (!c) stop(t('Нямаш игрови акаунт.'));
  return { me, company: c! };
}

// ── Take a load ──────────────────────────────────────────────────────────

/** "Поеми" / "Вземи част": the player's free trucks that can take this load (whole or the part they carry). */
export async function takeStart(ctx: Ctx, contractId: string): Promise<Answer> {
  const { me, company } = await account(ctx);
  const [c] = await ctx.db.select().from(contracts).where(eq(contracts.id, contractId));
  if (!c || c.status !== 'open' || c.expiresAt <= ctx.now) stop(t('Този товар вече не е на борсата.'));
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
  if (!options.length) stop(t('Нямаш свободен камион, който може да вземе този товар (вид надстройка, капацитет, ниво или шофьор).'));
  return answer(reply({
    content: t('📦 **{0}** · {1} т · {2} — с кой камион?', c!.goods, dec(c!.weightTons), money(c!.rewardCents)),
    components: rows(select(`take:go:${contractId}`, options.map(({ v, tons }) => ({
      label: `${v.plate} · ${v.model.name}`.slice(0, 100),
      value: tons ? `${v.id}:${tons}` : v.id,
      description: `${v.city.nameBg}${v.cityId === c!.originCityId ? t(' · на място') : ''}${tons ? t(' · част {0} т за {1}', dec(tons), money(partRewardCents(c!, tons))) : t(' · целия товар')}`,
      emoji: { name: tons ? '✂️' : '🚚' },
    })), t('Избери камион'))),
  }, true));
}

export async function takeGo(ctx: Ctx, contractId: string, pick: string): Promise<Answer> {
  const [vehicleId = '', part] = pick.split(':');
  const r = await act<{ etaAt: string | Date }>(ctx, { type: 'acceptContract', contractId, vehicleId, rush: false, overload: false, insure: false, route: 'fast', parking: 'free', refuel: false, ...(part ? { tons: Number(part) } : {}) });
  return answer(update({ content: t('✅ Камионът тръгна{0}! Пристига {1}.', part ? t(' с {0} т', dec(Number(part))) : '', at(r.etaAt)), components: rows(linkButton(t('Виж на картата'), `${appUrl()}/game/map`, '🗺️')) }));
}

// ── Convoys ──────────────────────────────────────────────────────────────

/** /конвой: the trip that just left goes to #конвои. */
export async function convoyCommand(ctx: Ctx): Promise<Answer> {
  const r = await act<{ origin: string; destination: string; expiresAt: string | Date }>(ctx, { type: 'announceConvoy' });
  return answer(say(t('🚚 Конвоят {0} → {1} е обявен в #конвои. Който тръгне по същия път до {2}, кара с теб.', r.origin, r.destination, at(r.expiresAt, 't'))));
}

/** "Включвам се": the loads on that lane for the player's free trucks. */
export async function convoyJoin(ctx: Ctx, convoyId: string): Promise<Answer> {
  const { me, company } = await account(ctx);
  const [c] = await ctx.db.select().from(openConvoys).where(and(eq(openConvoys.id, convoyId), gt(openConvoys.expiresAt, ctx.now)));
  if (!c) stop(t('Конвоят вече тръгна — следващия път!'));
  if (c!.userId === me.id) stop(t('Това е твоят конвой. 🙂'));
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
  if (!picks.length) stop(loads.length ? t('Няма товар за твоите свободни камиони по тази линия в момента. Виж борсата: {0}/game/contracts?lane={1}-{2}', appUrl(), c!.originCityId, c!.destCityId) : t('Няма товар по тази линия в момента. Виж борсата: {0}/game/contracts?lane={1}-{2}', appUrl(), c!.originCityId, c!.destCityId));
  return answer(reply({
    content: t('🚚 С кой камион и товар тръгваш?'),
    components: rows(select(`convoy:go:${convoyId}`, picks.map(({ v, load }) => ({ label: `${v.plate} · ${load.goods}`.slice(0, 100), value: `${v.id}/${load.id}`, description: t('{0} · {1} т · {2}', v.city.nameBg, dec(load.weightTons), money(load.rewardCents)), emoji: { name: '🚚' } })), t('Избери'))),
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
  return answer(update({ content: t('✅ Продадено на **{0}**.', buyer), embeds: (ctx.i.message?.embeds ?? []) as Record<string, unknown>[] }));
}

// ── /финанси ─────────────────────────────────────────────────────────────

export async function financeView(ctx: Ctx): Promise<Answer> {
  const { company } = await account(ctx);
  const a = await companyAnalytics(ctx.db, company.id, 7, ctx.now);
  const best = a.lanes[0];
  const truck = a.vehicles[0];
  return answer(reply({
    embeds: [{
      title: t('📊 Финанси · последните 7 дни'),
      url: `${appUrl()}/game/analytics`,
      color: a.netCents >= 0 ? 0x2fd27a : 0xe04545,
      fields: [
        { name: t('Нетно'), value: money(a.netCents), inline: true },
        { name: t('Възнаграждения'), value: money(a.revenueCents), inline: true },
        { name: t('Баланс'), value: money(company.balanceCents), inline: true },
        { name: t('Курсове'), value: t('{0} · {1} км · {2} т', a.trips, int(Math.round(a.km)), int(Math.round(a.tons))), inline: true },
        { name: t('Навреме'), value: a.trips ? `${Math.round(a.onTimeShare * 100)} %` : '—', inline: true },
        { name: t('Нетно на км'), value: a.km ? money(Math.round(a.netPerKmCents)) : '—', inline: true },
        ...(best ? [{ name: t('Най-добра линия'), value: `${a.names.lane[best.key]} · ${money(best.netCents)}`, inline: false }] : []),
        ...(truck ? [{ name: t('Най-добър камион'), value: t('{0} · {1} за {2} курса', a.names.vehicle[truck.key]?.plate ?? '—', money(truck.netCents), truck.trips), inline: false }] : []),
      ],
      footer,
    }],
  }, true));
}

// ── /дуел ────────────────────────────────────────────────────────────────

export async function duelCommand(ctx: Ctx): Promise<Answer> {
  const me = released(ctx);
  const target = opt(ctx.i, t('потребител'));
  if (target) {
    const [rival] = await ctx.db.select({ id: users.id, username: users.username }).from(users).where(eq(users.discordId, target));
    if (!rival) stop(t('Този член не е свързал акаунта си с играта.'));
    await act(ctx, { type: 'challengeDuel', userId: rival!.id });
    return answer(reply({ content: t('⚔️ Предизвика **{0}** на дуел: кой ще превози повече тонове за {1} дни. Победителят печели {2} ТрансКоин.', rival!.username, DUEL.days, DUEL.coins) }, true));
  }
  const list = await duelsOf(ctx.db, me.id);
  if (!list.length) return answer(say(t('Нямаш дуели. Предизвикай някого: `/дуел @потребител` — {0} дни, повече тонове печели {1} ТрансКоин.', DUEL.days, DUEL.coins)));
  const line = (d: (typeof list)[number]) =>
    d.status === 'active' ? t('⚔️ **{0}** · {1} : {2} т · край {3}', d.rival, dec(d.myTons), dec(d.theirTons), d.endsAt ? at(d.endsAt) : '')
    : d.status === 'pending' ? `⏳ **${d.rival}** · ${d.incoming ? t('те предизвика') : t('чака отговор')}`
    : d.status === 'done' ? t('{0} **{1}** · {2} : {3} т', d.won === true ? '🏆' : d.won === false ? '✖️' : '🤝', d.rival, dec(d.myTons), dec(d.theirTons))
    : `▫️ **${d.rival}** · ${d.status === 'declined' ? t('отказан') : t('изтекъл')}`;
  const incoming = list.filter((d) => d.incoming).slice(0, 2);
  return answer(reply({
    embeds: [{ title: t('⚔️ Дуелите ти'), color: BRAND, description: list.map(line).join('\n'), footer }],
    components: rows(...incoming.flatMap((d) => [button(t('Приеми · {0}', d.rival), `duel:yes:${d.id}`, STYLE.success, '⚔️'), button(t('Откажи'), `duel:no:${d.id}`, STYLE.secondary)])),
  }, true));
}

export async function duelAnswer(ctx: Ctx, duelId: string, accept: boolean): Promise<Answer> {
  await act(ctx, { type: 'respondDuel', duelId, accept });
  return answer(update({ content: accept ? t('⚔️ Дуелът започна! {0} дни — всеки тон се брои. Резултатът: `/дуел`.', DUEL.days) : t('Дуелът е отказан.') }));
}

// ── /пропуск ─────────────────────────────────────────────────────────────

export async function passCommand(ctx: Ctx): Promise<Answer> {
  const me = released(ctx);
  const p = await passView(ctx.db, me.id, ctx.now);
  const into = p.points - p.level * PASS_POINTS_PER_LEVEL;
  return answer(reply({
    embeds: [{
      title: t('🎟️ Сезонен пропуск · {0}', p.season.name),
      url: `${appUrl()}/game/pass`,
      color: p.premium ? 0xf6c343 : BRAND,
      description: t('Ниво **{0}** от {1}{2}\n{3}\n\n{4}', p.level, PASS_LEVELS, p.premium ? t(' · премиум') : '', p.level >= PASS_LEVELS ? t('Максимално ниво! 🏆') : t('{0} {1} / {2} точки до ниво {3}', bar(into / PASS_POINTS_PER_LEVEL), int(into), int(PASS_POINTS_PER_LEVEL), p.level + 1), p.claimable ? `🎁 **${p.claimable}** ${p.claimable === 1 ? t('награда те чака') : t('награди те чакат')}.` : t('Няма невзети награди.')),
      footer,
    }],
    components: p.claimable ? rows(button(t('Вземи наградите'), 'pass:claim', STYLE.success, '🎁')) : [],
  }, true));
}

export async function passClaim(ctx: Ctx): Promise<Answer> {
  await act(ctx, { type: 'claimSeasonPass' });
  return answer(update({ content: t('🎁 Наградите са твои! Виж ги в играта: {0}/game/pass', appUrl()), embeds: [] }));
}

// ── At a breakdown ───────────────────────────────────────────────────────

export async function roadPay(ctx: Ctx, deliveryId: string): Promise<Answer> {
  const r = await act<{ savedMs: number }>(ctx, { type: 'roadsidePaid', deliveryId });
  return answer(update({ content: t('🛠️ Пътната помощ идва — камионът тръгва {0} мин. по-рано ({1}).', Math.max(1, Math.round(r.savedMs / 60_000)), money(ROADSIDE.paidCents)) }));
}

export async function roadCall(ctx: Ctx, deliveryId: string): Promise<Answer> {
  const r = await act<{ asked: number }>(ctx, { type: 'callForHelp', deliveryId });
  return answer(update({ content: t('📣 Повика {0} {1}. Който е наблизо с камион, може да помогне.', r.asked, r.asked === 1 ? t('приятел/колега') : t('приятели и колеги')) }));
}

export async function roadHelp(ctx: Ctx, deliveryId: string): Promise<Answer> {
  const r = await act<{ savedMs: number; feeCents: number }>(ctx, { type: 'helpOnRoad', deliveryId });
  return answer(update({ content: t('🤝 Помогна! Камионът тръгва {0} мин. по-рано. Хонорар {1}.', Math.max(1, Math.round(r.savedMs / 60_000)), money(r.feeCents)) }));
}

// ── Livery contest ───────────────────────────────────────────────────────

export async function liveryVote(ctx: Ctx, entryId: string): Promise<Answer> {
  const r = await act<{ votes: number }>(ctx, { type: 'voteLivery', entryId });
  return answer(say(t('👍 Гласът ти е записан — камионът вече има {0} 👍.', r.votes)));
}

/** Worker: new entries of the livery contest go to #ливреи with their picture and a 👍 button. */
export async function postLiveryEntries(db: Database, now = new Date()) {
  if (!discordConfig().bot || !featureLive('livery_contest', now)) return 0;
  const channelId = await layoutChannel(db, t('ливреи'));
  if (!channelId) return 0;
  const fresh = await db.select({ e: liveryEntries, username: users.username }).from(liveryEntries).innerJoin(users, eq(users.id, liveryEntries.userId)).where(and(isNull(liveryEntries.messageId), gt(liveryEntries.createdAt, new Date(now.getTime() - 3 * 86_400_000)))).limit(20);
  let n = 0;
  for (const { e, username } of fresh) {
    // Taken first, so two workers do not post it twice.
    const [mine] = await db.update(liveryEntries).set({ messageId: 'posting' }).where(and(eq(liveryEntries.id, e.id), isNull(liveryEntries.messageId))).returning({ id: liveryEntries.id });
    if (!mine) continue;
    const msg = await discord<{ id: string }>('POST', `/channels/${channelId}/messages`, {
      embeds: [{ title: `🎨 ${username} · ${e.plate}`, color: Number.parseInt(e.color.replace('#', ''), 16) || BRAND, image: { url: `${appUrl()}/api/discord/card/livery/${e.id}` }, description: t('Дай 👍, ако ти харесва — най-харесваният камион на месеца печели.'), footer }],
      components: rows(button(t('Харесва ми'), `livery:vote:${e.id}`, STYLE.success, '👍')),
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
      title: t('⚔️ Битките тази седмица — на живо'),
      url: `${appUrl()}/game/company/missions`,
      color: 0xe04545,
      description: t('Край {0} · обновява се на всеки 10 минути', at(week.endsAt)),
      fields: top.map((b) => {
        const total = b.aTons + b.bTons;
        return { name: `${names.get(b.aId) ?? '—'} vs ${names.get(b.bId) ?? '—'}`.slice(0, 250), value: t('**{0}** : **{1}** т\n{2}', int(Math.round(b.aTons)), int(Math.round(b.bTons)), bar(total > 0 ? b.aTons / total : 0.5, 16)), inline: false };
      }),
      footer: { text: t('TransVerse · игрови данни · {0} битки', battles.length) },
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
  const channelId = await layoutChannel(db, t('битки'));
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
  if (!fleet.vehicles.length) stop(t('Нямаш камиони.'));
  const moving = fleet.vehicles.filter((v) => v.delivery);
  const lines = fleet.vehicles.slice(0, 12).map((v) => (v.delivery ? `🟠 **${v.plate}** → ${v.delivery.destination.nameBg}${v.delivery.etaAt ? ` · ${at(v.delivery.etaAt)}` : ''}` : `🟢 **${v.plate}** · ${v.city.nameBg}`));
  return answer(reply({
    embeds: [{
      title: t('🗺️ Камионите ти · {0} на път, {1} свободни', moving.length, fleet.vehicles.length - moving.length),
      url: `${appUrl()}/game/map`,
      color: BRAND,
      description: lines.join('\n'),
      image: { url: `${appUrl()}/api/discord/card/map/${me.id}?k=${mapCardToken(me.id, ctx.now)}&t=${Math.floor(ctx.now.getTime() / 60_000)}` },
      footer,
    }],
  }, true));
}

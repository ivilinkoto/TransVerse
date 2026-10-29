import { eq } from 'drizzle-orm';
import { dec, int, km, money } from '@/lib/format';
import { CARGO, type CargoType } from '@/lib/game/cargo';
import { combinationCapability, powerUnitModel, trailerModel } from '@/lib/game/catalog';
import { maxBidCents, floorBidCents } from '@/lib/game/auctions';
import { MISSIONS } from '@/lib/game/missions';
import { companies, users } from '@/server/db/schema';
import { auctionsBoard } from '@/server/game/auctions';
import { compatibilityError } from '@/server/game/deliveries';
import { membershipOf } from '@/server/game/membership';
import { missionBoard } from '@/server/game/missions';
import { fleetView } from '@/server/game/queries';
import { bestBuyers, tradeOverview } from '@/server/game/trade';
import { act, answer, field, opt, released, stop, type Answer, type Ctx } from './context';
import { appUrl, BRAND } from './config';
import { enqueue } from './outbox';
import { button, linkButton, modal, reply, rows, say, select, STYLE, textInput, update } from './ui';
import { t } from '@/i18n/t';

/**
 * More of the game from Discord: the warehouse (/пазар), the special loads
 * auction (/търг), missions (/мисии), "Браво" for a new building and company
 * invites (/покани). Every change goes through runAction.
 */

const at = (d: Date | string) => `<t:${Math.floor(new Date(d).getTime() / 1000)}:R>`;
const round1 = (n: number) => Math.round(n * 10) / 10;

async function account(ctx: Ctx) {
  const me = released(ctx);
  const [c] = await ctx.db.select().from(companies).where(eq(companies.ownerId, me.id));
  if (!c) stop(t('Нямаш игрови акаунт.'));
  return { me, company: c! };
}

// ── /пазар ────────────────────────────────────────────────────────────────

/** /пазар: the goods in the player's warehouses. */
export async function marketView(ctx: Ctx): Promise<Answer> {
  const { company } = await account(ctx);
  const depots = await tradeOverview(ctx.db, company.id, ctx.now);
  const lots = depots.flatMap((d) => d.stock.map((s) => ({ depot: d, ...s })));
  if (!lots.length) return answer(reply({ content: depots.length ? t('Складовете ти са празни. Купи стока в играта (Търговия).') : t('Нямаш склад. Търговията започва с депо (Автопарк → Депа).'), components: rows(linkButton(t('Търговия'), `${appUrl()}/game/trade`, '📦')) }, true));
  return answer(reply({
    embeds: [{
      title: t('📦 Твоите складове'),
      url: `${appUrl()}/game/trade`,
      color: BRAND,
      description: lots.map((l) => t('**{0}** · {1} т в {2} · средно {3}/т', CARGO[l.cargo].label, dec(l.tons), l.depot.name, money(l.avgCents))).join('\n'),
      footer: { text: t('Избери стока — ботът показва къде се плаща най-добре · игрови данни') },
    }],
    components: rows(select('market:lot', lots.slice(0, 25).map((l) => ({ label: t('{0} · {1} т', CARGO[l.cargo].label, dec(l.tons)), value: `${l.depot.id}|${l.cargo}`, description: t('в {0}', l.depot.name) })), t('Какво продаваш?'))),
  }, true));
}

/** The best buyers of a lot. */
export async function marketBuyers(ctx: Ctx, lot: string): Promise<Answer> {
  const { company } = await account(ctx);
  const [depotId, cargo] = lot.split('|') as [string, CargoType];
  const depot = (await tradeOverview(ctx.db, company.id, ctx.now)).find((d) => d.id === depotId);
  const stock = depot?.stock.find((s) => s.cargo === cargo);
  if (!depot || !stock) stop(t('Тази стока вече не е в склада.'));
  const buyers = await bestBuyers(ctx.db, depot!.cityId, cargo, ctx.now, 8);
  if (!buyers.length) stop(t('Няма купувачи на тази стока в момента.'));
  return answer(update({
    content: t('**{0}** · {1} т в {2} (средно {3}/т). Къде да я продадем?', CARGO[cargo].label, dec(stock!.tons), depot!.name, money(stock!.avgCents)),
    components: rows(select(`market:sell:${depotId}|${cargo}`, buyers.map((b) => ({ label: t('{0} · {1}/т', b.name, money(b.priceCents)), value: String(b.id), description: `~${km(b.km)} · ${b.priceCents > stock!.avgCents ? t('печалба') : t('под цената на склада')}` })), t('Град купувач'))),
  }));
}

/** Sends the lot (as much as a free truck there carries) to the chosen buyer. */
export async function marketSell(ctx: Ctx, lot: string, destCityId: number): Promise<Answer> {
  const { me, company } = await account(ctx);
  const [depotId, cargo] = lot.split('|') as [string, CargoType];
  const depot = (await tradeOverview(ctx.db, company.id, ctx.now)).find((d) => d.id === depotId);
  const stock = depot?.stock.find((s) => s.cargo === cargo);
  if (!depot || !stock) stop(t('Тази стока вече не е в склада.'));
  const fleet = await fleetView(ctx.db, company.id);
  // A free truck in the depot's city that can take this cargo; as much as it carries.
  const pick = fleet.vehicles
    .filter((v) => !v.delivery && v.cityId === depot!.cityId)
    .map((v) => {
      const cap = combinationCapability({ unit: powerUnitModel(v.modelId), trailer: v.trailer ? trailerModel(v.trailer.modelId) : null });
      const tons = round1(Math.min(stock!.tons, cap.payloadTons));
      const bundle = { modelId: v.modelId, trailerModelId: v.trailer?.modelId ?? null, condition: v.condition, hasDriver: !!v.driver, status: v.status, trailerCondition: v.trailer?.condition ?? null };
      return { v, tons, ok: compatibilityError(bundle, { cargoType: cargo, weightTons: tons, minLevel: 1 }, me.level) === null };
    })
    .filter((x) => x.ok)
    .sort((a, b) => b.tons - a.tons)[0];
  if (!pick) stop(t('Няма свободен камион в {0}, който да вземе {1}.', depot!.name, CARGO[cargo].label.toLowerCase()));
  const r = await act<{ etaAt: string | Date }>(ctx, { type: 'shipGoods', depotId, cargo, tons: pick!.tons, destCityId, vehicleId: pick!.v.id, mode: 'sell' });
  return answer(update({ content: t('✅ **{0}** тръгна с {1} т {2} — пристига {3}. Продава се на пазарната цена в деня на пристигане.', pick!.v.plate, dec(pick!.tons), CARGO[cargo].label.toLowerCase(), at(r.etaAt)), components: [] }));
}

// ── /търг ─────────────────────────────────────────────────────────────────

/** /търг: the special loads auction (the lowest offer wins the job). */
export async function auctionView(ctx: Ctx): Promise<Answer> {
  const { company } = await account(ctx);
  const board = await auctionsBoard(ctx.db, company.id, ctx.now);
  if (!board.open.length) return answer(reply({ content: t('В момента няма отворен търг. Следващият започва скоро — виж в играта.'), components: rows(linkButton(t('Търгове'), `${appUrl()}/game/auctions`, '🔨')) }, true));
  return answer(reply({
    embeds: board.open.slice(0, 3).map((a) => ({
      title: `🔨 ${a.title}`,
      url: `${appUrl()}/game/auctions`,
      color: 0xf6c343,
      description: t('{0} · {1} т · {2} → {3} · {4}', a.goods, dec(a.weightTons), a.from, a.to, km(a.distanceKm)),
      fields: [
        { name: t('Най-ниска оферта'), value: a.lowest ? `${money(a.lowest.amount)} (${a.lowest.username})` : t('няма'), inline: true },
        { name: t('Твоята'), value: a.myBid ? money(a.myBid) : '—', inline: true },
        { name: t('Можеш да предложиш'), value: `${money(floorBidCents(a.startPriceCents))} – ${money(maxBidCents(a.startPriceCents, a.lowest?.amount ?? null))}`, inline: true },
        { name: t('Край'), value: at(a.endsAt), inline: true },
        ...(a.coins ? [{ name: t('Бонус'), value: t('{0} ТрансКоин', a.coins), inline: true }] : []),
      ],
      footer: { text: t('Печели най-ниската оферта · игрови данни') },
    })),
    components: rows(...board.open.slice(0, 3).map((a, i) => button(t('Оферта {0}', board.open.length > 1 ? `№ ${i + 1}` : '').trim(), `auction:bid:${a.id}`, STYLE.primary, '💸'))),
  }, true));
}

export const auctionForm = (auctionId: string): Answer => answer(modal(`auction:offer:${auctionId}`, t('Твоята оферта'), [textInput('amount', t('Сума в лева (по-ниската печели)'), { min: 1, max: 12, placeholder: t('напр. 4500') })]));

export async function auctionOffer(ctx: Ctx, auctionId: string): Promise<Answer> {
  const amount = Number(field(ctx.i, 'amount').replace(/\s/g, '').replace(',', '.'));
  if (!(amount > 0)) stop(t('Напиши сума в лева.'));
  const r = await act<{ amountCents: number }>(ctx, { type: 'auctionBid', auctionId, amountEur: amount });
  return answer(say(t('✅ Офертата ти е **{0}**. Ще ти пишем, ако някой предложи по-ниско или спечелиш.', money(r.amountCents))));
}

// ── /мисии ────────────────────────────────────────────────────────────────

const PERIOD: Record<string, string> = { daily: 'Днес', weekly: 'Седмица', monthly: 'Месец', season: 'Сезон' };

/** /мисии: the current missions with "Вземи" for the finished ones. */
export async function missionsView(ctx: Ctx, how: 'reply' | 'update' = 'reply'): Promise<Answer> {
  const me = released(ctx);
  const board = await missionBoard(ctx.db, me.id, ctx.now);
  const all = [...board.current, ...board.unclaimed];
  const title = (id: string, target: number) => MISSIONS.find((m) => m.id === id)?.title(target) ?? id;
  const lines = all.map((m) => `${m.claimedAt ? '✅' : m.completedAt ? '🎁' : '▫️'} **${PERIOD[m.period] ?? ''}** · ${title(m.missionId, m.target)} — ${int(Math.min(m.progress, m.target))}/${int(m.target)}${m.completedAt && !m.claimedAt ? t(' · {0} + {1} опит', money(m.rewardCents), m.rewardXp) : ''}`);
  const ready = all.filter((m) => m.completedAt && !m.claimedAt).slice(0, 5);
  const data = {
    embeds: [{ title: t('🎯 Мисии'), url: `${appUrl()}/game/missions`, color: BRAND, description: lines.join('\n') || t('Няма мисии в момента.'), footer: { text: t('🎁 — изпълнена, вземи наградата · игрови данни') } }],
    components: ready.length ? rows(...ready.map((m) => button(t('Вземи: {0}', title(m.missionId, m.target)), `mission:claim:${m.periodKey}:${m.missionId}`, STYLE.success, '🎁'))) : [],
  };
  return answer(how === 'update' ? update(data) : reply(data, true));
}

export async function missionClaim(ctx: Ctx, periodKey: string, missionId: string): Promise<Answer> {
  await act(ctx, { type: 'claimMission', periodKey, missionId });
  return missionsView(ctx, 'update');
}

// ── "Браво" ───────────────────────────────────────────────────────────────

/** "Браво" under a new building in #строежи: a like for that company's base. */
export async function cheerBase(ctx: Ctx, organizationId: string): Promise<Answer> {
  const r = await act<{ liked?: boolean }>(ctx, { type: 'likePlot', organizationId });
  return answer(say(r.liked === false ? t('👍 Махнах харесването.') : t('👍 Харесано! Базата получава твоето „Браво“ и в играта.')));
}

// ── /покани ───────────────────────────────────────────────────────────────

/** /покани @член: an invite to the player's company (the invited answers with buttons). */
export async function inviteMember(ctx: Ctx): Promise<Answer> {
  const target = opt(ctx.i, 'потребител');
  if (!target) stop(t('Избери кого каниш.'));
  const [u] = await ctx.db.select({ id: users.id, username: users.username }).from(users).where(eq(users.discordId, target!));
  if (!u) stop(t('Този член няма свързан акаунт в играта — нека първо го свърже.'));
  const r = await act<{ id: string }>(ctx, { type: 'companyInvite', userId: u!.id });
  const m = await membershipOf(ctx.db, released(ctx).id);
  await enqueue(ctx.db, `invite-dm:${r.id}`, `dm:${target}`, {
    embeds: [{ title: t('📨 Покана от „{0}“', m?.company.name ?? t('компания')), description: t('{0} те кани в компанията си в TransVerse.', ctx.me!.username), color: BRAND }],
    components: rows(button(t('Приеми'), `invite:yes:${r.id}`, STYLE.success, '✅'), button(t('Откажи'), `invite:no:${r.id}`, STYLE.secondary), linkButton(t('Виж компанията'), `${appUrl()}/game/companies/${m?.company.id ?? ''}`, '🏢')),
  }, ctx.now);
  return answer(say(t('📨 Поканата до **{0}** е изпратена — и в играта, и като лично съобщение.', u!.username)));
}

export async function inviteAnswer(ctx: Ctx, inviteId: string, accept: boolean): Promise<Answer> {
  const r = await act<{ result: 'joined' | 'declined' }>(ctx, { type: 'companyInviteRespond', inviteId, accept });
  return answer(update({ content: r.result === 'joined' ? t('🎉 Добре дошъл в компанията! Каналът ѝ в Discord ще се появи до минута.') : t('Поканата е отказана.'), components: [] }));
}

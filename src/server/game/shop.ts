import { randomUUID } from 'node:crypto';
import { and, eq, isNull, like, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PLATE_PATTERN, RETRO, RETRO_BADGE, shopItem, VIP_DAYS, type RetroStyle, type ShopItemId } from '@/lib/game/shop';
import { isVip, STANDARD_COLORS, VIP_COLORS } from '@/lib/game/vip';
import { HALLOWEEN, isHalloween } from '@/lib/game/halloween';
import { CHRISTMAS, isChristmas } from '@/lib/game/christmas';
import { registerSchema } from '@/server/auth/accounts';
import type { Database, Tx } from '@/server/db/client';
import { cityMarkets, companyMembers, drivers, jobState, organizations, trailers, userBadges, users, vehicles } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { powerUnitModel } from '@/lib/game/catalog';
import { COSMETIC_PARTS, parseCosmetic, parseTrailerCosmetic, stickerText, TRAILER_COSMETIC_PARTS } from '@/lib/game/cosmetics';
import { postCoins } from './coins';
import { companyForUser } from './company';
import { fail } from './errors';
import { logActivity, notify } from './notify';

export const shopPurchaseSchema = z.object({
  item: z.string().max(30),
  vehicleId: z.string().uuid().optional(),
  cityId: z.coerce.number().int().positive().optional(),
  plate: z.string().trim().toUpperCase().max(10).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  username: z.string().trim().max(20).optional(),
  recipient: z.string().trim().max(20).optional(),
  cosmetic: z.string().max(20).optional(),
  trailerId: z.string().uuid().optional(),
});
export type ShopPurchase = z.infer<typeof shopPurchaseSchema>;

const DAY = 86_400_000;
/** Extends a time-limited status from whichever is later: now or the current end. */
const extend = (current: Date | null, ms: number, now: Date) => new Date(Math.max(now.getTime(), current?.getTime() ?? 0) + ms);

async function ownVehicle(tx: Tx, companyId: string, vehicleId: string | undefined, { owned = true, idle = false } = {}) {
  if (!vehicleId) fail('vehicle_required', 'Изберете камион.');
  const [v] = await tx.select().from(vehicles).where(and(eq(vehicles.id, vehicleId!), eq(vehicles.companyId, companyId), isNull(vehicles.soldAt))).for('update');
  if (!v) fail('vehicle_not_found', 'Камионът не е намерен.', 404);
  if (owned && v!.ownership !== 'owned') fail('rented', 'Наетите камиони са на наемодателя — изберете собствен камион.');
  if (idle && v!.status !== 'idle') fail('vehicle_busy', 'Камионът е на курс.');
  return v!;
}

/** Buys a shop item with ТрансКоин: coins and the effect in one transaction. */
export async function buyShopItem(db: Database, userId: string, input: ShopPurchase, now = new Date()) {
  const item = shopItem(input.item);
  if (!item) fail('unknown_item', 'Непознат продукт.');
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
    const vip = isVip(user!.vipUntil, now);
    const account = await companyForUser(tx, userId);
    let price = item!.price;
    let summary = item!.label;

    switch (item!.id as ShopItemId) {
      case 'vip_7':
      case 'vip_30':
      case 'vip_90': {
        const until = extend(user!.vipUntil, VIP_DAYS[item!.id]! * DAY, now);
        await tx.update(users).set({ vipUntil: until }).where(eq(users.id, userId));
        summary = `${item!.label} (до ${until.toLocaleDateString('bg-BG')})`;
        break;
      }
      case 'gift_vip_30': {
        if (!input.recipient) fail('recipient_required', 'Въведете потребителското име на играча.');
        const [to] = await tx.select().from(users).where(sql`lower(${users.username}) = lower(${input.recipient})`).for('update');
        if (!to || to.bannedAt) fail('recipient_not_found', 'Няма активен играч с такова име.', 404);
        if (to!.id === userId) fail('gift_self', 'Подаръкът е за друг играч — за себе си изберете „VIP · 30 дни“.');
        const until = extend(to!.vipUntil, 30 * DAY, now);
        await tx.update(users).set({ vipUntil: until }).where(eq(users.id, to!.id));
        await notify(tx, to!.id, 'achievement', `${user!.username} ти подари VIP!`, `30 дни VIP — активен до ${until.toLocaleDateString('bg-BG')}.`, '/game/shop');
        summary = `Подарък VIP 30 дни за ${to!.username}`;
        break;
      }
      case 'xp_boost_24h': {
        const until = extend(user!.xpBoostUntil, DAY, now);
        await tx.update(users).set({ xpBoostUntil: until }).where(eq(users.id, userId));
        summary = `${item!.label} (до ${until.toLocaleString('bg-BG', { timeZone: 'Europe/Sofia' })})`;
        break;
      }
      case 'instant_repair': {
        const v = await ownVehicle(tx, account.id, input.vehicleId, { idle: true });
        const [t] = await tx.select().from(trailers).where(eq(trailers.vehicleId, v.id));
        if (v.condition >= 100 && (!t || t.condition >= 100)) fail('nothing_to_repair', 'Камионът е в отлично състояние.');
        await tx.update(vehicles).set({ condition: 100 }).where(eq(vehicles.id, v.id));
        if (t) await tx.update(trailers).set({ condition: 100 }).where(eq(trailers.id, t.id));
        summary = `Моментален ремонт ${v.plate}`;
        break;
      }
      case 'instant_relocate': {
        const v = await ownVehicle(tx, account.id, input.vehicleId, { owned: false, idle: true });
        if (!input.cityId) fail('city_required', 'Изберете град.');
        const [hub] = await tx.select({ id: cityMarkets.cityId }).from(cityMarkets).where(eq(cityMarkets.cityId, input.cityId!)).limit(1);
        if (!hub) fail('not_hub', 'Изберете град от товарния пазар.');
        if (v.cityId === input.cityId) fail('same_city', 'Камионът вече е в този град.');
        await tx.update(vehicles).set({ cityId: input.cityId! }).where(eq(vehicles.id, v.id));
        await tx.update(trailers).set({ cityId: input.cityId! }).where(eq(trailers.vehicleId, v.id));
        summary = `Преместване на ${v.plate}`;
        break;
      }
      case 'custom_plate': {
        const v = await ownVehicle(tx, account.id, input.vehicleId);
        const plate = (input.plate ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
        if (!PLATE_PATTERN.test(plate)) fail('invalid_plate', 'Табелата е 2–10 главни букви, цифри, интервал или тире.');
        const { rows: clash } = await tx.execute<{ taken: boolean }>(
          sql`select exists(select 1 from vehicles where upper(plate) = ${plate} and sold_at is null) or exists(select 1 from trailers where upper(plate) = ${plate} and sold_at is null) as taken`,
        );
        const taken = clash[0]?.taken;
        if (taken) fail('plate_taken', 'Такава табела вече има.', 409);
        await tx.update(vehicles).set({ plate }).where(eq(vehicles.id, v.id));
        summary = `Табела „${plate}“ за ${v.plate}`;
        break;
      }
      case 'paint': {
        const v = await ownVehicle(tx, account.id, input.vehicleId);
        const color = (input.color ?? '').toLowerCase();
        const standard = STANDARD_COLORS.includes(color);
        if (!standard && !VIP_COLORS.includes(color)) fail('invalid_color', 'Изберете цвят от палитрата.');
        if (!standard && !vip) fail('vip_only', 'Този цвят е ексклузивен за VIP играчите.', 403);
        if (vip) price = 0;
        await tx.update(vehicles).set({ color, livery: null }).where(eq(vehicles.id, v.id));
        summary = `Пребоядисване на ${v.plate}`;
        break;
      }
      case 'paint_pumpkin': {
        if (!isHalloween(now)) fail('not_in_season', 'Боята „Тиква“ се продава само по Хелуин.');
        const v = await ownVehicle(tx, account.id, input.vehicleId);
        if (v.livery === 'pumpkin') fail('already_painted', 'Камионът вече е с боя „Тиква“.');
        await tx.update(vehicles).set({ color: HALLOWEEN.pumpkinColor, livery: 'pumpkin' }).where(eq(vehicles.id, v.id));
        summary = `Боя „Тиква“ за ${v.plate}`;
        break;
      }
      case 'paint_christmas': {
        if (!isChristmas(now)) fail('not_in_season', 'Боята „Коледа“ се продава само по Коледа.');
        const v = await ownVehicle(tx, account.id, input.vehicleId);
        if (v.livery === 'christmas') fail('already_painted', 'Камионът вече е с боя „Коледа“.');
        await tx.update(vehicles).set({ color: CHRISTMAS.paintColor, livery: 'christmas' }).where(eq(vehicles.id, v.id));
        summary = `Боя „Коледа“ за ${v.plate}`;
        break;
      }
      case 'paint_retro70':
      case 'paint_retro80':
      case 'paint_retro90': {
        if (!(await featureFor(tx, userId, 'retro_collection', now))) fail('not_released', 'Това идва със следващото обновление.', 403);
        const style = input.item.slice(6) as RetroStyle;
        const v = await ownVehicle(tx, account.id, input.vehicleId);
        if (v.livery === style) fail('already_painted', 'Камионът вече е с тази боя.');
        await tx.update(vehicles).set({ color: RETRO[style].color, livery: style }).where(eq(vehicles.id, v.id));
        summary = `Ретро боя „${style.slice(5)}-те“ за ${v.plate}`;
        // The collection: all three paints bought (on any trucks) earn the badge.
        await tx.insert(jobState).values({ key: `retro:${userId}:${style}`, value: { at: now.toISOString() } }).onConflictDoNothing();
        const [{ n = 0 } = {}] = await tx.select({ n: sql<number>`count(*)::int` }).from(jobState).where(like(jobState.key, `retro:${userId}:%`));
        if (n >= Object.keys(RETRO).length) {
          const [got] = await tx.insert(userBadges).values({ userId, badge: RETRO_BADGE }).onConflictDoNothing().returning();
          if (got) await notify(tx, userId, 'achievement', 'Значка: Ретро колекционер', 'Събра и трите ретро бои.', '/game/profile');
        }
        break;
      }
      case 'truck_part': {
        if (!(await featureFor(tx, userId, 'cosmetics', now))) fail('not_released', 'Това идва със следващото обновление.', 403);
        const choice = parseCosmetic(input.cosmetic ?? '');
        if (!choice) fail('invalid_part', 'Изберете част и стил.');
        const v = await ownVehicle(tx, account.id, input.vehicleId);
        if (powerUnitModel(v.modelId).kind === 'van') fail('van', 'Частите са за камиони, не за бусове.');
        const { part, style } = choice!;
        let value = style;
        if (part === 'sticker') {
          const [org] = await tx.select({ name: organizations.name }).from(companyMembers).innerJoin(organizations, eq(organizations.id, companyMembers.companyId)).where(eq(companyMembers.userId, userId));
          if (!org) fail('no_company', 'Стикерът е с името на компанията — първо влез в компания.');
          value = stickerText(org!.name);
        }
        if (v.cosmetics[part] === value) fail('already_fitted', 'Камионът вече е с тази част.');
        await tx.update(vehicles).set({ cosmetics: { ...v.cosmetics, [part]: value } }).where(eq(vehicles.id, v.id));
        price = COSMETIC_PARTS[part].price;
        summary = `${COSMETIC_PARTS[part].label} (${COSMETIC_PARTS[part].styles.find((s) => s.id === style)!.label}) за ${v.plate}`;
        break;
      }
      case 'trailer_part': {
        if (!(await featureFor(tx, userId, 'trailer_cosmetics', now))) fail('not_released', 'Това идва със следващото обновление.', 403);
        const choice = parseTrailerCosmetic(input.cosmetic ?? '');
        if (!choice) fail('invalid_part', 'Изберете част и стил.');
        if (!input.trailerId) fail('trailer_required', 'Изберете ремарке.');
        const [t] = await tx.select().from(trailers).where(and(eq(trailers.id, input.trailerId!), eq(trailers.companyId, account.id), isNull(trailers.soldAt))).for('update');
        if (!t) fail('trailer_not_found', 'Ремаркето не е намерено.', 404);
        if (t!.ownership !== 'owned') fail('rented', 'Наетите и фирмените ремаркета не се променят — изберете свое.');
        const { part, style } = choice!;
        if (t!.cosmetics[part] === style) fail('already_fitted', 'Ремаркето вече е с тази част.');
        await tx.update(trailers).set({ cosmetics: { ...t!.cosmetics, [part]: style } }).where(eq(trailers.id, t!.id));
        price = TRAILER_COSMETIC_PARTS[part].price;
        summary = `${TRAILER_COSMETIC_PARTS[part].label} (${TRAILER_COSMETIC_PARTS[part].styles.find((s) => s.id === style)!.label}) за ремарке ${t!.plate}`;
        break;
      }
      case 'rename': {
        const parsed = registerSchema.shape.username.safeParse(input.username ?? '');
        if (!parsed.success) fail('invalid_username', parsed.error.issues[0]?.message ?? 'Невалидно име.');
        const name = parsed.data!;
        const [taken] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = lower(${name})`);
        if (taken && taken.id !== userId) fail('username_taken', 'Това потребителско име е заето.', 409);
        if (name === user!.username) fail('same_name', 'Това е текущото ти име.');
        await tx.update(users).set({ username: name }).where(eq(users.id, userId));
        await tx.update(drivers).set({ name }).where(and(eq(drivers.companyId, account.id), eq(drivers.isOwner, true)));
        summary = `Ново име: ${name} (беше ${user!.username})`;
        break;
      }
    }

    if (price > 0) await postCoins(tx, userId, { amount: -price, reason: 'shop', description: summary, idempotencyKey: `shop:${userId}:${randomUUID()}` }, { requireFunds: true });
    await logActivity(tx, userId, 'shop_purchase', { item: item!.id, price, summary });
    return { item: item!.id, price, summary };
  });
}

import { randomBytes } from 'node:crypto';
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { companies, promoCodes, promoRedemptions, users } from '@/server/db/schema';
import { ITEMS, type ItemId } from '@/lib/game/items';
import { PROMO, normalizeCode, rewardIsEmpty, type PromoReward } from '@/lib/game/promo';
import { REFERRAL_CODE } from '@/lib/game/referrals';
import { rateLimit } from '@/server/auth/rate-limit';
import { recordAudit, requireAdminRole, requireStaff, type Staff } from '@/server/admin';
import { postCoins } from './coins';
import { fail } from './errors';
import { post } from './finance';
import { grantItem } from './inventory';
import { logActivity, notify } from './notify';
import { date } from '@/lib/format';
import { t } from '@/i18n/t';

/**
 * 1.1.4.3 „Промокодове“. A player redeems a code once; the reward is paid in one
 * transaction with idempotency keys (`promo:<code>:<player>`), the code's use
 * counter cannot go over its limit, and two accounts from the same network
 * cannot both take the same code. A friend's invite code works here too, within
 * the first days after sign-up.
 */
const DAY = 86_400_000;

export interface RedeemResult {
  kind: 'promo' | 'invite';
  code: string;
  reward: PromoReward;
  inviter?: string;
}

export async function redeemCode(db: Database, userId: string, raw: string, ipHash: string | null, via: 'web' | 'discord' = 'web', now = new Date()): Promise<RedeemResult> {
  await rateLimit(db, `promo:${userId}`, PROMO.attempts, PROMO.attemptWindowSeconds);
  const code = normalizeCode(raw);
  if (!PROMO.pattern.test(code)) fail('promo_unknown', t('Няма такъв код. Провери буквите и цифрите.'));
  const [row] = await db.select().from(promoCodes).where(eq(promoCodes.code, code));
  if (!row) {
    if (REFERRAL_CODE.test(code)) return redeemInvite(db, userId, code, ipHash, now);
    fail('promo_unknown', t('Няма такъв код. Провери буквите и цифрите.'));
  }
  const promo = row!;
  if (promo.disabledAt) fail('promo_disabled', t('Този код е спрян.'));
  if (promo.startsAt && promo.startsAt > now) fail('promo_not_started', t('Кодът още не е активен.'));
  if (promo.endsAt && promo.endsAt <= now) fail('promo_expired', t('Кодът е изтекъл.'));
  return db.transaction(async (tx) => {
    const [me] = await tx.select({ level: users.level, createdAt: users.createdAt, bannedAt: users.bannedAt, signupIp: users.signupIpHash }).from(users).where(eq(users.id, userId));
    if (!me || me.bannedAt) fail('forbidden', t('Нямате достъп.'), 403);
    if (me!.level < promo.minLevel) fail('promo_level', t('Кодът е за играчи от ниво {0}.', promo.minLevel));
    if (promo.accountsBefore && me!.createdAt > promo.accountsBefore) fail('promo_new_account', t('Кодът е за профили, създадени преди {0}.', date(promo.accountsBefore)));
    const [mine] = await tx.select({ id: promoRedemptions.id }).from(promoRedemptions).where(and(eq(promoRedemptions.codeId, promo.id), eq(promoRedemptions.userId, userId)));
    if (mine) fail('promo_used', t('Вече си използвал този код.'));
    // Up to PROMO.perNetwork accounts per network (two people at home may both play); more are most likely extra accounts.
    const nets = [ipHash, me!.signupIp].filter((x): x is string => !!x);
    if (nets.length) {
      const same = await tx
        .selectDistinct({ userId: promoRedemptions.userId })
        .from(promoRedemptions)
        .innerJoin(users, eq(users.id, promoRedemptions.userId))
        .where(and(eq(promoRedemptions.codeId, promo.id), or(...nets.map((n) => or(eq(promoRedemptions.ipHash, n), eq(users.signupIpHash, n))))))
        .limit(PROMO.perNetwork);
      if (same.length >= PROMO.perNetwork) fail('same_network', t('Кодът вече е използван от {0} профила от същата мрежа.', PROMO.perNetwork), 403);
    }
    const [counted] = await tx
      .update(promoCodes)
      .set({ uses: sql`${promoCodes.uses} + 1` })
      .where(and(eq(promoCodes.id, promo.id), or(isNull(promoCodes.maxUses), lt(promoCodes.uses, promoCodes.maxUses))))
      .returning({ uses: promoCodes.uses });
    if (!counted) fail('promo_used_up', t('Кодът вече е използван до края.'));
    const inserted = await tx.insert(promoRedemptions).values({ codeId: promo.id, userId, via, ipHash }).onConflictDoNothing().returning({ id: promoRedemptions.id });
    if (!inserted.length) fail('promo_used', t('Вече си използвал този код.'));
    await payReward(tx, userId, promo.reward, `promo:${promo.id}:${userId}`, t('Промокод {0}', promo.code), now);
    await logActivity(tx, userId, 'promo_redeemed', { code: promo.code, via });
    return { kind: 'promo' as const, code: promo.code, reward: promo.reward };
  });
}

async function payReward(tx: Tx, userId: string, reward: PromoReward, key: string, label: string, now: Date) {
  if (reward.coins) await postCoins(tx, userId, { amount: reward.coins, reason: 'promo', description: label, idempotencyKey: `${key}:coins` });
  if (reward.cents) {
    const [company] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
    if (company) await post(tx, company.id, [{ category: 'promo', amountCents: reward.cents, description: label, idempotencyKey: `${key}:cents` }]);
  }
  if (reward.vipDays) {
    const [u] = await tx.select({ vipUntil: users.vipUntil }).from(users).where(eq(users.id, userId)).for('update');
    const from = Math.max(now.getTime(), u?.vipUntil?.getTime() ?? 0);
    await tx.update(users).set({ vipUntil: new Date(from + reward.vipDays * DAY) }).where(eq(users.id, userId));
  }
  for (const it of reward.items ?? []) {
    if (it.qty > 0 && it.itemId in ITEMS) await grantItem(tx, userId, it.itemId as ItemId, it.qty, 'promo', `${key}:item:${it.itemId}`);
  }
}

/** A friend's invite code, typed in within the first days: the invite counts as at sign-up, and a bronze case to start with. */
async function redeemInvite(db: Database, userId: string, code: string, ipHash: string | null, now: Date): Promise<RedeemResult> {
  return db.transaction(async (tx) => {
    const [me] = await tx.select({ createdAt: users.createdAt, by: users.referredById, ip: users.signupIpHash }).from(users).where(eq(users.id, userId)).for('update');
    const [inviter] = await tx.select({ id: users.id, username: users.username, ip: users.signupIpHash }).from(users).where(eq(users.referralCode, code));
    if (!inviter) fail('promo_unknown', t('Няма такъв код. Провери буквите и цифрите.'));
    if (inviter!.id === userId) fail('promo_own_invite', t('Това е твоят код за покани — дай го на приятел.'));
    if (me!.by) fail('promo_invited', t('Вече си записан като поканен от приятел.'));
    if (now.getTime() - me!.createdAt.getTime() > PROMO.inviteDays * DAY) fail('promo_invite_late', t('Код на приятел се въвежда до {0} дни след регистрацията.', PROMO.inviteDays));
    if (inviter!.ip && (inviter!.ip === me!.ip || inviter!.ip === ipHash)) fail('same_network', t('Поканата не важи от същата мрежа.'), 403);
    await tx.update(users).set({ referredById: inviter!.id }).where(eq(users.id, userId));
    await logActivity(tx, userId, 'referred', { inviterId: inviter!.id, via: 'code' });
    await grantItem(tx, userId, 'case_bronze', 1, 'invite', `invite-case:${userId}`);
    await notify(tx, inviter!.id, 'info', () => t('Нов поканен играч'), () => t('Някой въведе твоя код. Когато направи първите си доставки, и двамата получавате награда.'), '/game/invite');
    return { kind: 'invite' as const, code, reward: { items: [{ itemId: 'case_bronze', qty: 1 }] }, inviter: inviter!.username };
  });
}

// ── For the team ─────────────────────────────────────────────────────────

export interface PromoInput {
  code?: string;
  reward: PromoReward;
  maxUses?: number | null;
  minLevel?: number;
  accountsBefore?: Date | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  note?: string;
}

function checkReward(r: PromoReward) {
  if (rewardIsEmpty(r)) fail('promo_empty', t('Кодът трябва да дава поне една награда.'));
  if ((r.coins ?? 0) < 0 || (r.coins ?? 0) > PROMO.maxCoins) fail('promo_reward', t('ТрансКоин: от 0 до {0}.', PROMO.maxCoins));
  if ((r.cents ?? 0) < 0 || (r.cents ?? 0) > PROMO.maxCents) fail('promo_reward', t('Пари: до {0} лв.', PROMO.maxCents / 100));
  if ((r.vipDays ?? 0) < 0 || (r.vipDays ?? 0) > PROMO.maxVipDays) fail('promo_reward', t('VIP: до {0} дни.', PROMO.maxVipDays));
  const items = r.items ?? [];
  if (items.length > PROMO.maxItems) fail('promo_reward', t('До {0} вида предмети.', PROMO.maxItems));
  if (new Set(items.map((it) => it.itemId)).size !== items.length) fail('promo_reward', t('Всеки предмет само веднъж — с по-голям брой.'));
  for (const it of items) {
    if (!(it.itemId in ITEMS) || ITEMS[it.itemId as ItemId].kind === 'coins') fail('unknown_item', t('Непознат предмет.'));
    if (!Number.isInteger(it.qty) || it.qty < 1 || it.qty > PROMO.maxItemQty) fail('promo_reward', t('Предмети: от 1 до {0} броя.', PROMO.maxItemQty));
  }
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomPart = (n: number) => Array.from(randomBytes(n), (b) => ALPHABET[b % ALPHABET.length]).join('');

/** An administrator makes one public code (typed or generated). */
export async function createPromo(db: DbOrTx, actor: Staff | null, input: PromoInput) {
  requireStaff(actor);
  requireAdminRole(actor);
  checkReward(input.reward);
  const code = normalizeCode(input.code ?? '') || `TV-${randomPart(6)}`;
  if (!PROMO.pattern.test(code)) fail('promo_format', t('Кодът е от 4 до 32 знака: латински букви, цифри и тире.'));
  if (REFERRAL_CODE.test(code)) fail('promo_format', t('Кодът не може да прилича на код за покана (8 знака без тире) — добави тире или цифра.'));
  if (input.endsAt && input.startsAt && input.endsAt <= input.startsAt) fail('promo_dates', t('Краят трябва да е след началото.'));
  const [row] = await db
    .insert(promoCodes)
    .values({ code, kind: 'public', reward: input.reward, maxUses: input.maxUses ?? null, minLevel: input.minLevel ?? 1, accountsBefore: input.accountsBefore ?? null, startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null, note: input.note?.trim() || null, createdBy: actor!.id })
    .onConflictDoNothing()
    .returning();
  if (!row) fail('promo_taken', t('Код „{0}“ вече има.', code));
  await recordAudit(db, actor!.id, 'promo_create', null, { code, reward: input.reward, maxUses: input.maxUses ?? null });
  return row!;
}

/** An administrator makes a batch of single-use codes (a tournament, a stream). */
export async function createPromoBatch(db: Database, actor: Staff | null, input: Omit<PromoInput, 'code' | 'maxUses'> & { count: number; prefix?: string }) {
  requireStaff(actor);
  requireAdminRole(actor);
  checkReward(input.reward);
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > PROMO.maxBatch) fail('promo_batch', t('От 1 до {0} кода наведнъж.', PROMO.maxBatch));
  const prefix = normalizeCode(input.prefix ?? 'TV').replace(/-+$/, '') || 'TV';
  if (!/^[A-Z0-9]{1,12}$/.test(prefix)) fail('promo_format', t('Представката е до 12 латински букви и цифри.'));
  const batchId = crypto.randomUUID();
  const codes: string[] = [];
  await db.transaction(async (tx) => {
    while (codes.length < input.count) {
      const code = `${prefix}-${randomPart(8)}`;
      const [row] = await tx
        .insert(promoCodes)
        .values({ code, kind: 'single', reward: input.reward, maxUses: 1, minLevel: input.minLevel ?? 1, accountsBefore: input.accountsBefore ?? null, startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null, batchId, note: input.note?.trim() || null, createdBy: actor!.id })
        .onConflictDoNothing()
        .returning({ code: promoCodes.code });
      if (row) codes.push(row.code);
    }
  });
  await recordAudit(db, actor!.id, 'promo_batch', null, { prefix, count: codes.length, reward: input.reward, batchId });
  return { batchId, codes };
}

export async function setPromoDisabled(db: DbOrTx, actor: Staff | null, id: string, disabled: boolean, now = new Date()) {
  requireStaff(actor);
  requireAdminRole(actor);
  const [row] = await db.update(promoCodes).set({ disabledAt: disabled ? now : null }).where(eq(promoCodes.id, id)).returning({ code: promoCodes.code, batchId: promoCodes.batchId });
  if (!row) fail('not_found', t('Кодът не е намерен.'), 404);
  // A batch is stopped and started together.
  if (row!.batchId) await db.update(promoCodes).set({ disabledAt: disabled ? now : null }).where(eq(promoCodes.batchId, row!.batchId));
  await recordAudit(db, actor!.id, disabled ? 'promo_disable' : 'promo_enable', null, { code: row!.code });
}

/** The codes for the admin page: public ones one by one, single-use ones grouped by batch. */
export async function promoOverview(db: DbOrTx, limit = 100) {
  const rows = await db.select().from(promoCodes).orderBy(desc(promoCodes.createdAt)).limit(2000);
  const singles = new Map<string, { batchId: string; prefix: string; count: number; used: number; reward: PromoReward; createdAt: Date; disabled: boolean; firstId: string; endsAt: Date | null; note: string | null }>();
  const publics = [];
  for (const r of rows) {
    if (r.kind === 'single' && r.batchId) {
      const g = singles.get(r.batchId) ?? { batchId: r.batchId, prefix: r.code.split('-')[0] ?? '', count: 0, used: 0, reward: r.reward, createdAt: r.createdAt, disabled: !!r.disabledAt, firstId: r.id, endsAt: r.endsAt, note: r.note };
      g.count++;
      g.used += r.uses;
      singles.set(r.batchId, g);
    } else publics.push(r);
  }
  return { publics: publics.slice(0, limit), batches: [...singles.values()].slice(0, limit) };
}

export async function batchCodes(db: DbOrTx, batchId: string) {
  return db.select({ code: promoCodes.code, uses: promoCodes.uses }).from(promoCodes).where(eq(promoCodes.batchId, batchId)).orderBy(promoCodes.code);
}

export async function promoRedeemers(db: DbOrTx, codeId: string, limit = 50) {
  return db
    .select({ username: users.username, via: promoRedemptions.via, at: promoRedemptions.createdAt })
    .from(promoRedemptions)
    .innerJoin(users, eq(users.id, promoRedemptions.userId))
    .where(eq(promoRedemptions.codeId, codeId))
    .orderBy(desc(promoRedemptions.createdAt))
    .limit(limit);
}

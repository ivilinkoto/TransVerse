import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { FEATURES } from '@/lib/game/features';
import { normalizeCode, PROMO } from '@/lib/game/promo';
import { closeDb } from '@/server/db/client';
import { coinEntries, companies, inventoryItems, ledgerEntries, promoCodes, promoRedemptions, users } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { createPromo, createPromoBatch, redeemCode, setPromoDisabled } from '@/server/game/promo';
import { ensureReferralCode } from '@/server/game/referrals';
import { db, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const admin = (id: string) => ({ id, role: 'admin', username: 'admin' });
const tag = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const coinsOf = async (userId: string) => (await db().select({ c: users.coins }).from(users).where(eq(users.id, userId)))[0]!.c;

describe('1.1.4.3 promo codes — rules', () => {
  it('is a 1.1.4.3 feature; codes are forgiving to type', () => {
    expect(FEATURES.promo_codes).toBe('1.1.4.3');
    expect(normalizeCode('  buditeli 2026 ')).toBe('BUDITELI2026');
    expect(PROMO.pattern.test('TV-ABC123')).toBe(true);
    expect(PROMO.pattern.test('a b')).toBe(false);
  });
});

describe('1.1.4.3 promo codes — server', () => {
  it('a public code pays coins, money, VIP and items once per player, and stops at its limit', async () => {
    const boss = await newPlayer();
    const name = `FB-${tag()}`;
    await createPromo(db(), admin(boss.userId), { code: name.toLowerCase(), reward: { coins: 20, cents: 500_00, vipDays: 2, items: [{ itemId: 'case_bronze', qty: 1 }] }, maxUses: 2 });
    const [a, b, c] = [await playerWithCompany(), await playerWithCompany(), await playerWithCompany()];
    const before = await coinsOf(a.userId);
    const r = await redeemCode(db(), a.userId, ` ${name.toLowerCase()} `, null);
    expect(r).toMatchObject({ kind: 'promo', code: name });
    expect((await coinsOf(a.userId)) - before).toBe(20);
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, a.userId));
    expect((await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, acc!.id), eq(ledgerEntries.category, 'promo')))).map((x) => x.amountCents)).toEqual([500_00]);
    const [u] = await db().select({ vip: users.vipUntil }).from(users).where(eq(users.id, a.userId));
    expect(u!.vip!.getTime()).toBeGreaterThan(Date.now() + 86_400_000);
    expect((await db().select().from(inventoryItems).where(and(eq(inventoryItems.userId, a.userId), eq(inventoryItems.itemId, 'case_bronze'))))[0]?.qty).toBe(1);
    expect(await code(redeemCode(db(), a.userId, name, null))).toBe('promo_used');
    await redeemCode(db(), b.userId, name, null);
    expect(await code(redeemCode(db(), c.userId, name, null))).toBe('promo_used_up');
    const [row] = await db().select().from(promoCodes).where(eq(promoCodes.code, name));
    expect(row!.uses).toBe(2);
    expect(await db().select().from(coinEntries).where(and(eq(coinEntries.userId, a.userId), eq(coinEntries.reason, 'promo')))).toHaveLength(1);
  });

  it('unknown, stopped, expired, too-low level, new accounts and the same network are refused', async () => {
    const boss = await newPlayer();
    const p = await playerWithCompany();
    expect(await code(redeemCode(db(), p.userId, 'NOPE-0000', null))).toBe('promo_unknown');
    const stopped = await createPromo(db(), admin(boss.userId), { code: `STOP-${tag()}`, reward: { coins: 1 } });
    await setPromoDisabled(db(), admin(boss.userId), stopped.id, true);
    expect(await code(redeemCode(db(), p.userId, stopped.code, null))).toBe('promo_disabled');
    const old = await createPromo(db(), admin(boss.userId), { code: `OLD-${tag()}`, reward: { coins: 1 }, endsAt: new Date(Date.now() - 1000) });
    expect(await code(redeemCode(db(), p.userId, old.code, null))).toBe('promo_expired');
    const high = await createPromo(db(), admin(boss.userId), { code: `HI-${tag()}`, reward: { coins: 1 }, minLevel: 50 });
    expect(await code(redeemCode(db(), p.userId, high.code, null))).toBe('promo_level');
    const before = await createPromo(db(), admin(boss.userId), { code: `PRE-${tag()}`, reward: { coins: 1 }, accountsBefore: new Date(Date.now() - 86_400_000) });
    expect(await code(redeemCode(db(), p.userId, before.code, null))).toBe('promo_new_account');
    const net = await createPromo(db(), admin(boss.userId), { code: `NET-${tag()}`, reward: { coins: 1 } });
    // Two people at home may both take it; a third account from the same network may not.
    const [second, third] = [await playerWithCompany(), await playerWithCompany()];
    await redeemCode(db(), p.userId, net.code, 'same-net-hash');
    expect(await code(redeemCode(db(), second.userId, net.code, 'same-net-hash'))).toBe('ok');
    expect(await code(redeemCode(db(), third.userId, net.code, 'same-net-hash'))).toBe('same_network');
  });

  it('only administrators make codes; rewards have limits; a batch makes single-use codes', async () => {
    const boss = await newPlayer();
    expect(await code(createPromo(db(), { id: boss.userId, role: 'support', username: 's' }, { reward: { coins: 1 } }))).toBe('forbidden');
    expect(await code(createPromo(db(), admin(boss.userId), { reward: {} }))).toBe('promo_empty');
    expect(await code(createPromo(db(), admin(boss.userId), { reward: { coins: PROMO.maxCoins + 1 } }))).toBe('promo_reward');
    expect(await code(createPromo(db(), admin(boss.userId), { code: 'ABCDEFGH', reward: { coins: 1 } }))).toBe('promo_format');
    const { codes } = await createPromoBatch(db(), admin(boss.userId), { count: 3, prefix: 'cup', reward: { coins: 5 } });
    expect(codes).toHaveLength(3);
    expect(new Set(codes).size).toBe(3);
    for (const c of codes) expect(c).toMatch(/^CUP-[A-Z2-9]{8}$/);
    const [x, y] = [await playerWithCompany(), await playerWithCompany()];
    await redeemCode(db(), x.userId, codes[0]!, null, 'discord');
    expect(await code(redeemCode(db(), y.userId, codes[0]!, null))).toBe('promo_used_up');
    const [red] = await db().select().from(promoRedemptions).where(eq(promoRedemptions.userId, x.userId));
    expect(red!.via).toBe('discord');
  });

  it("a friend's invite code within the first days: counted as invited, a bronze case, once", async () => {
    const friend = await playerWithCompany();
    const invite = await ensureReferralCode(db(), friend.userId);
    const me = await playerWithCompany();
    expect(await code(redeemCode(db(), friend.userId, invite, null))).toBe('promo_own_invite');
    const r = await redeemCode(db(), me.userId, invite.toLowerCase(), null);
    expect(r).toMatchObject({ kind: 'invite' });
    const [u] = await db().select({ by: users.referredById }).from(users).where(eq(users.id, me.userId));
    expect(u!.by).toBe(friend.userId);
    expect(await code(redeemCode(db(), me.userId, invite, null))).toBe('promo_invited');
    const late = await playerWithCompany();
    await db().update(users).set({ createdAt: new Date(Date.now() - 9 * 86_400_000) }).where(eq(users.id, late.userId));
    expect(await code(redeemCode(db(), late.userId, invite, null))).toBe('promo_invite_late');
  });

  it('one code gives several items at once; the same item twice is refused', async () => {
    const boss = await newPlayer();
    const name = `MULTI-${tag()}`;
    await createPromo(db(), admin(boss.userId), { code: name, reward: { items: [{ itemId: 'case_bronze', qty: 1 }, { itemId: 'coffee', qty: 2 }, { itemId: 'repair_kit', qty: 1 }] } });
    const p = await newPlayer();
    await redeemCode(db(), p.userId, name, null);
    const got = await db().select().from(inventoryItems).where(eq(inventoryItems.userId, p.userId));
    const qty = (id: string) => got.find((g) => g.itemId === id)?.qty ?? 0;
    expect([qty('case_bronze'), qty('coffee'), qty('repair_kit')]).toEqual([1, 2, 1]);
    expect(await code(createPromo(db(), admin(boss.userId), { code: `${name}X`, reward: { items: [{ itemId: 'coffee', qty: 1 }, { itemId: 'coffee', qty: 2 }] } }))).toBe('promo_reward');
  });
});

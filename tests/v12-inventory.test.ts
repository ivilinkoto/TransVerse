import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));

import { SECTIONS, visibleTabs } from '@/components/game/nav';
import { FEATURES } from '@/lib/game/features';
import { CASE_TABLES, ITEMS, ITEM_IDS, caseOdds, isCase, pickFrom } from '@/lib/game/items';
import { faceFor, isFemaleName } from '@/lib/game/portraits';
import { releaseByVersion } from '@/lib/game/releases';
import { closeDb } from '@/server/db/client';
import { companies, drivers, inventoryItems, itemEffects, itemLog, ledgerEntries, userBadges } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { applyItem, applyNoRest, coverLate, dailyCase, grantItem, openCase, queueExtra } from '@/server/game/inventory';
import { db, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const qty = async (userId: string, itemId: string) => (await db().select().from(inventoryItems).where(and(eq(inventoryItems.userId, userId), eq(inventoryItems.itemId, itemId))))[0]?.qty ?? 0;
const give = (userId: string, itemId: keyof typeof ITEMS, key: string, n = 1) => db().transaction((tx) => grantItem(tx, userId, itemId, n, 'test', `${key}:${userId}`));
async function driverOf(userId: string, restedAt: Date | null = null) {
  const [acc] = await db().select().from(companies).where(eq(companies.ownerId, userId));
  const [d] = await db().insert(drivers).values({ companyId: acc!.id, name: 'Иван Тестов', skill: 1, salaryCentsPerDay: 100_00, restedAt }).returning();
  return { acc: acc!, d: d! };
}

describe('1.2 inventory — rules', () => {
  it('registers the three features under 1.2 and notes them in the release', () => {
    for (const id of ['inventory', 'driver_portraits', 'truck_pass'] as const) expect(FEATURES[id]).toBe('1.2');
    const r = releaseByVersion('1.2')!;
    expect(r.highlights.map((h) => h.title)).toEqual(expect.arrayContaining(['Инвентар и кейсове', 'Лица на шофьорите', 'Truck Pass']));
  });

  it('case tables only hold real items, never cases, and the odds add up to 100 %', () => {
    for (const [caseId, table] of Object.entries(CASE_TABLES)) {
      for (const [item] of table) {
        expect(ITEM_IDS).toContain(item);
        expect(isCase(item)).toBe(false);
      }
      const sum = caseOdds(caseId as keyof typeof CASE_TABLES).reduce((s, o) => s + o.percent, 0);
      expect(Math.round(sum)).toBe(100);
    }
    expect(pickFrom([['coffee', 1], ['thermos', 1]], 0)).toBe('coffee');
    expect(pickFrom([['coffee', 1], ['thermos', 1]], 0.99)).toBe('thermos');
  });

  it('portraits: the same face every time, female names get a female face', () => {
    expect(faceFor('a', 'Иван Петров')).toEqual(faceFor('a', 'Иван Петров'));
    expect(isFemaleName('Мария Петрова')).toBe(true);
    expect(isFemaleName('Иван Петров')).toBe(false);
    expect(faceFor('x', 'Мария Петрова').female).toBe(true);
    expect(faceFor('x', 'Мария Петрова').beard).toBe(0);
  });

  it('with Truck Pass the menu shows one season entry instead of season + pass', () => {
    const tabs = (has: boolean) => SECTIONS.flatMap((s) => visibleTabs(s, null, '/game', (f) => (f === 'truck_pass' ? has : true))).map((t) => t.href);
    expect(tabs(true).filter((h) => h === '/game/seasons')).toHaveLength(1);
    expect(tabs(true)).not.toContain('/game/pass');
    expect(tabs(false)).toContain('/game/pass');
    expect(tabs(false).filter((h) => h === '/game/seasons')).toHaveLength(1);
  });
});

describe('1.2 inventory — server', () => {
  it('a grant with the same key is given once', async () => {
    const p = await playerWithCompany();
    expect(await give(p.userId, 'coffee', 'twice')).toBe(true);
    expect(await give(p.userId, 'coffee', 'twice')).toBe(false);
    expect(await qty(p.userId, 'coffee')).toBe(1);
  });

  it('opening a case takes the case and gives one item from its table', async () => {
    const p = await playerWithCompany();
    await give(p.userId, 'case_gold', 'gold');
    expect(await code(openCase(db(), p.userId, 'case_bronze'))).toBe('no_item');
    const { item } = await openCase(db(), p.userId, 'case_gold', new Date(), () => 0);
    expect(item).toBe(CASE_TABLES.case_gold[0]![0]);
    expect(await qty(p.userId, 'case_gold')).toBe(0);
    expect(await qty(p.userId, item)).toBe(1);
  });

  it('coffee halves the rest, an energy drink ends it, and both are used up', async () => {
    const p = await playerWithCompany();
    const now = new Date();
    const { d } = await driverOf(p.userId, new Date(now.getTime() + 60 * 60_000));
    await give(p.userId, 'coffee', 'c');
    await give(p.userId, 'energy_drink', 'e');
    await applyItem(db(), p.userId, 'coffee', { driverId: d.id }, now);
    const [half] = await db().select().from(drivers).where(eq(drivers.id, d.id));
    expect(Math.round((half!.restedAt!.getTime() - now.getTime()) / 60_000)).toBe(30);
    await applyItem(db(), p.userId, 'energy_drink', { driverId: d.id }, now);
    const [done] = await db().select().from(drivers).where(eq(drivers.id, d.id));
    expect(done!.restedAt!.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(await qty(p.userId, 'coffee')).toBe(0);
    expect(await code(applyItem(db(), p.userId, 'coffee', { driverId: d.id }, now))).toBe('not_resting');
  });

  it('cab coffee: no rest after a trip while it lasts', async () => {
    const p = await playerWithCompany();
    const now = new Date();
    const { d } = await driverOf(p.userId);
    await give(p.userId, 'cab_coffee', 'cab');
    await applyItem(db(), p.userId, 'cab_coffee', { driverId: d.id }, now);
    const later = new Date(now.getTime() + 5 * 3_600_000);
    await db().update(drivers).set({ restedAt: new Date(later.getTime() + 3_600_000) }).where(eq(drivers.id, d.id));
    expect(await db().transaction((tx) => applyNoRest(tx, p.userId, [d.id], later))).toBe(1);
    const [after] = await db().select().from(drivers).where(eq(drivers.id, d.id));
    expect(after!.restedAt!.getTime()).toBe(later.getTime());
    const expired = new Date(now.getTime() + 25 * 3_600_000);
    expect(await db().transaction((tx) => applyNoRest(tx, p.userId, [d.id], expired))).toBe(0);
  });

  it('single-trip insurance covers one late penalty; queue ticket adds slots; voucher pays', async () => {
    const p = await playerWithCompany();
    const now = new Date();
    await give(p.userId, 'cargo_cover', 'cover');
    await give(p.userId, 'queue_ticket', 'queue');
    await give(p.userId, 'fuel_voucher', 'fuel');
    await applyItem(db(), p.userId, 'cargo_cover', {}, now);
    expect(await db().transaction((tx) => coverLate(tx, p.userId))).toBe(true);
    expect(await db().transaction((tx) => coverLate(tx, p.userId))).toBe(false);
    expect(await queueExtra(db(), p.userId, now)).toBe(0);
    await applyItem(db(), p.userId, 'queue_ticket', {}, now);
    expect(await queueExtra(db(), p.userId, now)).toBe(2);
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    await applyItem(db(), p.userId, 'fuel_voucher', {}, now);
    const paid = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, acc!.id), eq(ledgerEntries.category, 'items')));
    expect(paid.map((e) => e.amountCents)).toEqual([150_00]);
    const effects = await db().select().from(itemEffects).where(eq(itemEffects.userId, p.userId));
    expect(effects.map((e) => e.effect).sort()).toEqual(['cover_late', 'queue_extra']);
  });

  it('a cap goes on the portrait once; cases and collectibles are not used', async () => {
    const p = await playerWithCompany();
    const { d } = await driverOf(p.userId);
    await give(p.userId, 'trucker_cap', 'cap', 2);
    await give(p.userId, 'case_bronze', 'bronze');
    await give(p.userId, 'cb_mic', 'mic');
    await applyItem(db(), p.userId, 'trucker_cap', { driverId: d.id });
    const [looked] = await db().select().from(drivers).where(eq(drivers.id, d.id));
    expect(looked!.look).toMatchObject({ cap: true });
    expect(await code(applyItem(db(), p.userId, 'trucker_cap', { driverId: d.id }))).toBe('has_look');
    expect(await qty(p.userId, 'trucker_cap')).toBe(1);
    expect(await code(applyItem(db(), p.userId, 'case_bronze', {}))).toBe('open_case');
    expect(await code(applyItem(db(), p.userId, 'cb_mic', {}))).toBe('collectible');
  });

  it('all four road memories give the badge once', async () => {
    const p = await playerWithCompany();
    for (const id of ['old_tachograph', 'truck_keychain', 'road_atlas'] as const) await give(p.userId, id, id);
    expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, p.userId), eq(userBadges.badge, 'road-memories')))).toHaveLength(0);
    await give(p.userId, 'cb_mic', 'mic1');
    await give(p.userId, 'cb_mic', 'mic2');
    expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, p.userId), eq(userBadges.badge, 'road-memories')))).toHaveLength(1);
  });

  it('daily reward: day 7 gives a silver case, other days a bronze one by chance, once per day', async () => {
    const p = await playerWithCompany();
    const now = new Date();
    expect(await db().transaction((tx) => dailyCase(tx, p.userId, 7, '2026-11-07', now))).toBe(true);
    expect(await db().transaction((tx) => dailyCase(tx, p.userId, 7, '2026-11-07', now))).toBe(false);
    expect(await db().transaction((tx) => dailyCase(tx, p.userId, 3, '2026-11-08', now, 0.9))).toBe(false);
    expect(await db().transaction((tx) => dailyCase(tx, p.userId, 3, '2026-11-09', now, 0.1))).toBe(true);
    expect(await qty(p.userId, 'case_silver')).toBe(1);
    expect(await qty(p.userId, 'case_bronze')).toBe(1);
    expect((await db().select().from(itemLog).where(eq(itemLog.userId, p.userId))).length).toBe(2);
  });
});

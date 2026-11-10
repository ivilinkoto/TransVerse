import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * 1.3 „Зимен поход“ with the real dates (no feature mocks): the first step opens
 * with the release on 12.11 at 10:00, one more each Sofia day, steps go in order
 * and pay at once; the seventh gives the paint „Скреж“.
 */
import { ITEMS, PASS_ONLY_ITEMS, sourcesOf } from '@/lib/game/items';
import { TREK_STEPS, trekIncrement, trekStepDay, trekUnlocked, WINTER_TREK } from '@/lib/game/winter-trek';
import { closeDb } from '@/server/db/client';
import { companies, inventoryItems, notifications, users } from '@/server/db/schema';
import { recordWinterTrek, winterTrekView, type TrekFacts } from '@/server/game/winter-trek';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const at = (s: string) => new Date(s);
const day = (n: number, time = '12:00') => at(`2026-11-${String(12 + n).padStart(2, '0')}T${time}:00+02:00`);
/** A trip that finishes any step at once. */
const big = (userId: string, country = 'DE'): TrekFacts => ({ userId, loadedKm: 900, late: false, cargoType: 'refrigerated', destCountry: country, tons: 60, ownerDrove: true });
const record = (f: TrekFacts, when: Date) => db().transaction((tx) => recordWinterTrek(tx, f, when));
const balance = async (userId: string) => (await db().select({ b: companies.balanceCents }).from(companies).where(eq(companies.ownerId, userId)))[0]!.b;

describe('1.3 „Зимен поход“', () => {
  it('opens one step a day from the release, Sofia time', () => {
    expect(trekUnlocked(at('2026-11-12T09:59:00+02:00'))).toBe(0);
    expect(trekUnlocked(at('2026-11-12T10:00:00+02:00'))).toBe(1);
    expect(trekUnlocked(at('2026-11-12T23:59:00+02:00'))).toBe(1);
    expect(trekUnlocked(at('2026-11-13T00:01:00+02:00'))).toBe(2);
    expect(trekUnlocked(at('2026-11-18T08:00:00+02:00'))).toBe(7);
    expect(trekUnlocked(at('2026-12-01T08:00:00+02:00'))).toBe(7);
    expect(trekStepDay(0)).toBe('2026-11-12');
    expect(trekStepDay(6)).toBe('2026-11-18');
    expect(TREK_STEPS).toHaveLength(7);
  });

  it('what a trip adds to each kind of step', () => {
    const f = { loadedKm: 812.4, late: true, cargoType: 'dry', destCountry: 'RO', tons: 24.6 };
    expect(trekIncrement('deliveries', f, [])).toBe(1);
    expect(trekIncrement('km', f, [])).toBe(812);
    expect(trekIncrement('ontime', f, [])).toBe(0);
    expect(trekIncrement('reefer', f, [])).toBe(0);
    expect(trekIncrement('countries', f, ['RO'])).toBe(0);
    expect(trekIncrement('countries', f, ['BG'])).toBe(1);
    expect(trekIncrement('long', f, [])).toBe(1);
    expect(trekIncrement('heavy', f, [])).toBe(25);
  });

  it('the paint „Скреж“ comes only from the trek', () => {
    expect(ITEMS.paint_frost.rarity).toBe('legendary');
    expect(PASS_ONLY_ITEMS).toContain('paint_frost');
    expect(sourcesOf('paint_frost').map((s) => s.source)).toContain('Последната стъпка на „Зимен поход“');
  });

  it('players see nothing before the release; the staff try the first step', async () => {
    const p = await newPlayer();
    const early = at('2026-11-11T12:00:00+02:00');
    expect(await winterTrekView(db(), p.userId, early)).toBeNull();
    await record(big(p.userId), early);
    expect((await winterTrekView(db(), p.userId, day(0)))!.done).toBe(0);

    const staff = await newPlayer();
    await db().update(users).set({ role: 'admin' }).where(eq(users.id, staff.userId));
    const view = (await winterTrekView(db(), staff.userId, early))!;
    expect(view.open).toBe(1);
    expect(view.steps[0]!.state).toBe('current');
    expect(view.steps[1]!.state).toBe('locked');
  });

  it('steps go in order, one a day, and pay at once; the seventh gives the paint', async () => {
    const p = await newPlayer();
    const start = await balance(p.userId);
    const coins0 = (await db().select({ coins: users.coins }).from(users).where(eq(users.id, p.userId)))[0]!.coins;

    // Day 1: two deliveries finish step 1; a third waits for tomorrow.
    await record({ ...big(p.userId), loadedKm: 100 }, day(0));
    let view = (await winterTrekView(db(), p.userId, day(0)))!;
    expect(view.steps[0]).toMatchObject({ state: 'current', progress: 1 });
    await record(big(p.userId), day(0));
    await record(big(p.userId), day(0));
    view = (await winterTrekView(db(), p.userId, day(0)))!;
    expect(view.done).toBe(1);
    expect(view.steps[1]!.state).toBe('locked');
    expect(await balance(p.userId)).toBe(start + TREK_STEPS[0]!.cents);

    // A trip driven by a hired driver does not count.
    await record({ ...big(p.userId), ownerDrove: false }, day(1));
    expect((await winterTrekView(db(), p.userId, day(1)))!.steps[1]!.progress).toBe(0);

    // Each day, trips until the day's step is done (a different country each time).
    const lands = ['DE', 'RO', 'GR', 'AT'];
    for (let n = 1; n < 7; n++) {
      for (let i = 0; (await winterTrekView(db(), p.userId, day(n)))!.done === n; i++) {
        expect(i).toBeLessThan(4);
        await record(big(p.userId, lands[i]!), day(n));
      }
      expect((await winterTrekView(db(), p.userId, day(n)))!.done).toBe(n + 1);
    }
    view = (await winterTrekView(db(), p.userId, day(7)))!;
    expect(view.finished).toBe(true);
    expect(await balance(p.userId)).toBe(start + TREK_STEPS.reduce((s, x) => s + x.cents, 0));
    const coins = (await db().select({ coins: users.coins }).from(users).where(eq(users.id, p.userId)))[0]!.coins;
    expect(coins - coins0).toBe(TREK_STEPS.reduce((s, x) => s + x.coins, 0));
    const [paint] = await db().select().from(inventoryItems).where(and(eq(inventoryItems.userId, p.userId), eq(inventoryItems.itemId, 'paint_frost')));
    expect(paint?.qty).toBe(1);
    const notes = await db().select({ title: notifications.title }).from(notifications).where(and(eq(notifications.userId, p.userId), eq(notifications.href, '/game/missions')));
    expect(notes).toHaveLength(7);

    // Nothing more after the end; the card goes away when the season ends.
    await record(big(p.userId), day(8));
    expect(await balance(p.userId)).toBe(start + TREK_STEPS.reduce((s, x) => s + x.cents, 0));
    expect(await winterTrekView(db(), p.userId, new Date(WINTER_TREK.to))).toBeNull();
  });
});

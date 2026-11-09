import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { DOCK, bookSlot, slotOf, withDockWait } from '@/lib/game/dock';
import { FEATURES, featureLive } from '@/lib/game/features';
import { LETTERS, letterKind, thanksBonus } from '@/lib/game/letters';
import { CROWD_CAP, DEFAULT_MAP_LAYERS, mapLayers, nearestFirst } from '@/lib/game/map-layers';
import { POSTCARD, postcardReason, postcardScene } from '@/lib/game/postcard';
import { releaseByVersion } from '@/lib/game/releases';
import { closeDb } from '@/server/db/client';
import { clientLetters, companies, deliveries, dockSlots, users, vehicles } from '@/server/db/schema';
import { acceptContract, settleDelivery } from '@/server/game/deliveries';
import { answerDockSwap, dockView, offerDockSwap, planDock } from '@/server/game/dock';
import { GameError } from '@/server/game/errors';
import { post } from '@/server/game/finance';
import { lettersView, markLettersRead, unreadLetters } from '@/server/game/letters';
import { postcardView, sharePostcard } from '@/server/game/postcards';
import { setUiPrefs } from '@/server/game/ui-prefs';
import { cityByName, db, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));

describe('1.2.3.6 „Чиста карта“: rules', () => {
  it('is live with its release', () => {
    const at = new Date(releaseByVersion('1.2.3.6')!.publishedAt);
    for (const f of ['map_layers', 'delivery_postcard', 'dock_slots', 'client_letters'] as const) {
      expect(FEATURES[f]).toBe('1.2.3.6');
      expect(featureLive(f, at)).toBe(true);
    }
  });

  it('map layers: the defaults show everything but „only moving“, a stored choice wins', () => {
    expect(mapLayers(null)).toEqual(DEFAULT_MAP_LAYERS);
    expect(DEFAULT_MAP_LAYERS.movingOnly).toBe(false);
    expect(mapLayers({ others: false, plates: false })).toMatchObject({ others: false, plates: false, mine: true, friends: true });
  });

  it('keeps the nearest trucks (and the one in focus) in their order', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: i, p: [42 + i, 23] as [number, number] }));
    expect(nearestFirst(items, [42, 23], 3, (x) => x.p).map((x) => x.id)).toEqual([0, 1, 2]);
    expect(nearestFirst(items, [51, 23], 3, (x) => x.p).map((x) => x.id)).toEqual([7, 8, 9]);
    expect(nearestFirst(items, [42, 23], 3, (x) => x.p, (x) => x.id === 9).map((x) => x.id)).toEqual([0, 1, 9]);
    expect(nearestFirst(items, null, 20, (x) => x.p)).toHaveLength(10);
    expect(CROWD_CAP).toBe(150);
  });

  it('dock: the slot of the arrival, the next free one when it is full, and the wait in the unloading', () => {
    const slot = DOCK.slotMin * 60_000;
    const arrive = slotOf(Date.UTC(2026, 10, 9, 10, 0)) + 5 * 60_000;
    expect(bookSlot(arrive, new Map())).toEqual({ slotAt: slotOf(arrive), waitMs: 0 });
    const full = new Map([[slotOf(arrive), DOCK.perSlot]]);
    expect(bookSlot(arrive, full)).toEqual({ slotAt: slotOf(arrive) + slot, waitMs: slot - 5 * 60_000 });
    const segs: { kind: string; leg: string; start: number; end: number; fromKm: number; toKm: number; note?: string }[] = [
      { kind: 'drive', leg: 'loaded', start: 0, end: 100, fromKm: 0, toKm: 10 },
      { kind: 'unloading', leg: 'loaded', start: 100, end: 145, fromKm: 10, toKm: 10 },
    ];
    const waited = withDockWait(segs, 30);
    expect(waited[1]).toMatchObject({ start: 100, end: 175, note: 'Опашка на рампата' });
    const back = withDockWait(waited, 0, 30);
    expect(back[1]).toMatchObject({ start: 100, end: 145 });
    expect(back[1]!.note).toBeUndefined();
  });

  it('letters: about one in seven on-time trips, a third of the late ones, the bonus within bounds', () => {
    let onTime = 0;
    let late = 0;
    const kinds = new Set<string>();
    for (let i = 0; i < 4000; i++) {
      const k = letterKind(`letter:${i}`, false);
      if (k) (onTime++, kinds.add(k));
      if (letterKind(`letter:${i}`, true)) late++;
    }
    expect(onTime / 4000).toBeGreaterThan(LETTERS.chance - 0.03);
    expect(onTime / 4000).toBeLessThan(LETTERS.chance + 0.03);
    expect(late / 4000).toBeGreaterThan(LETTERS.complaintChance - 0.04);
    expect([...kinds].sort()).toEqual(['request', 'thanks']);
    expect(letterKind('letter:x', true)).not.toBe('thanks');
    expect(thanksBonus(10_00)).toBe(LETTERS.thanksMinCents);
    expect(thanksBonus(100_000_00)).toBe(LETTERS.thanksMaxCents);
  });

  it('postcards: a new city or a long trip', () => {
    expect(postcardReason(true, 100)).toBe('first_city');
    expect(postcardReason(false, POSTCARD.longKm)).toBe('long_trip');
    expect(postcardReason(false, 300)).toBeNull();
    expect(postcardScene('first_city', new Date('2026-12-20T10:00:00Z'))).toBe('snow');
    expect(postcardScene('long_trip', new Date('2026-06-20T10:00:00Z'))).toBe('sunset');
  });
});

describe('1.2.3.6 „Чиста карта“: the game', () => {
  it('keeps the map layers in the profile, one switch at a time', async () => {
    const p = await newPlayer('Sofia');
    await setUiPrefs(db(), p.userId, { mapLayers: { others: false } });
    await setUiPrefs(db(), p.userId, { mapLayers: { plates: false } });
    const [u] = await db().select({ prefs: users.uiPrefs }).from(users).where(eq(users.id, p.userId));
    expect(u!.prefs.mapLayers).toEqual({ others: false, plates: false });
  });

  it('a full dock means a queue; a swap for a gift moves both unloadings and pays the gift', async () => {
    const sofia = await cityByName('Sofia');
    expect(sofia.population).toBeGreaterThanOrEqual(DOCK.minPopulation);
    const now = new Date();
    const players = [];
    for (let i = 0; i < DOCK.perSlot + 1; i++) {
      const p = await newPlayer('Plovdiv');
      const [co] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
      const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, co!.id));
      const c = await makeContract('Plovdiv', 'Sofia');
      const d = await acceptContract(db(), p.userId, c.id, truck!.id, now);
      players.push({ ...p, company: co!, delivery: d });
    }
    // Other tests share the warehouse: put these four in known slots — three in one, the fourth queued for the next.
    const rows = await db().select().from(deliveries).where(inArray(deliveries.id, players.map((p) => p.delivery.id)));
    const old = await db().select().from(dockSlots).where(inArray(dockSlots.deliveryId, players.map((p) => p.delivery.id)));
    expect(old).toHaveLength(DOCK.perSlot + 1);
    const late = players[DOCK.perSlot]!;
    const lateRow = rows.find((r) => r.id === late.delivery.id)!;
    const arriveOf = (sched: unknown) => (sched as { kind: string; leg: string; start: number; stop?: number }[]).findLast((x) => x.kind === 'unloading' && x.leg === 'loaded' && !x.stop)!.start;
    const S = slotOf(arriveOf(lateRow.schedule));
    for (const p of players) {
      const r = rows.find((x) => x.id === p.delivery.id)!;
      const o = old.find((x) => x.deliveryId === p.delivery.id)!;
      const queued = p === late;
      const arrive = arriveOf(r.schedule);
      const waitMs = queued ? S + DOCK.slotMin * 60_000 - arrive : 0;
      const schedule = withDockWait(r.schedule as never[], waitMs, o.waitMin * 60_000) as { end: number }[];
      await db().update(deliveries).set({ schedule, etaAt: new Date(Math.max(...schedule.map((x) => x.end))) }).where(eq(deliveries.id, r.id));
      await db().update(dockSlots).set({ slotAt: new Date(queued ? S + DOCK.slotMin * 60_000 : S), arriveAt: new Date(arrive), waitMin: Math.round(waitMs / 60_000) }).where(eq(dockSlots.deliveryId, r.id));
    }
    // A full slot sends the next truck to the queue.
    const planned = await db().transaction((tx) => planDock(tx, late.userId, sofia.id, lateRow.schedule as never, now));
    expect(planned!.booking.slotAt.getTime()).toBeGreaterThanOrEqual(S + DOCK.slotMin * 60_000);
    expect(planned!.booking.waitMin).toBeGreaterThan(0);
    const early = players[0]!;
    const earlySlot = { slotAt: new Date(S) };
    const [row] = await db().select().from(deliveries).where(eq(deliveries.id, late.delivery.id));
    const unload = (row!.schedule as { kind: string; note?: string }[]).findLast((s) => s.kind === 'unloading');
    expect(unload!.note).toBe('Опашка на рампата');

    const view = await dockView(db(), late.userId, now);
    expect(view.bookings[0]!.swaps.map((s) => s.deliveryId)).toContain(early.delivery.id);
    expect(await code(offerDockSwap(db(), late.userId, late.delivery.id, early.delivery.id, 10_00, now))).toBe('invalid_gift');
    expect(await code(offerDockSwap(db(), early.userId, early.delivery.id, late.delivery.id, 100_00, now))).toBe('no_gain');
    await db().transaction((tx) => post(tx, late.company.id, [{ category: 'admin_adjustment', amountCents: 1_000_00, description: 'test', idempotencyKey: `test:dock:${late.company.id}` }]));
    const before = async (id: string) => (await db().select({ b: companies.balanceCents }).from(companies).where(eq(companies.id, id)))[0]!.b;
    const [lateBefore, earlyBefore] = [await before(late.company.id), await before(early.company.id)];
    await offerDockSwap(db(), late.userId, late.delivery.id, early.delivery.id, 100_00, now);
    const incoming = (await dockView(db(), early.userId, now)).incoming;
    expect(incoming).toHaveLength(1);
    const res = await answerDockSwap(db(), early.userId, incoming[0]!.id, true, now);
    expect(res.accepted).toBe(true);
    const after = await db().select().from(dockSlots).where(inArray(dockSlots.deliveryId, [late.delivery.id, early.delivery.id]));
    expect(after.find((s) => s.deliveryId === late.delivery.id)!.slotAt.getTime()).toBe(earlySlot.slotAt.getTime());
    expect(after.find((s) => s.deliveryId === late.delivery.id)!.waitMin).toBe(0);
    expect(after.find((s) => s.deliveryId === early.delivery.id)!.slotAt.getTime()).toBe(S + DOCK.slotMin * 60_000);
    const [lateAfter] = await db().select().from(deliveries).where(eq(deliveries.id, late.delivery.id));
    expect(lateAfter!.etaAt.getTime()).toBeLessThan(row!.etaAt.getTime());
    expect(await before(late.company.id)).toBe(lateBefore - 100_00);
    expect(await before(early.company.id)).toBe(earlyBefore + 100_00);
    // The offer is used up.
    expect(await code(answerDockSwap(db(), early.userId, incoming[0]!.id, true, now))).toBe('not_found');

    // On arrival: the first trip to Sofia has a postcard; it can be shared once.
    await db().transaction((tx) => settleDelivery(tx, late.delivery.id, new Date(lateAfter!.etaAt.getTime() + 1000)));
    const card = await postcardView(db(), late.delivery.id);
    expect(card?.reason).toBe('first_city');
    expect(card?.truck.modelId).toBeTruthy();
    expect(await code(sharePostcard(db(), early.userId, late.delivery.id))).toBe('not_found');
    expect(await code(sharePostcard(db(), late.userId, late.delivery.id))).toBe('ok');
    expect(await code(sharePostcard(db(), late.userId, late.delivery.id))).toBe('already_shared');

    // A letter (written by hand here; on arrival it comes by chance) is shown and then marked read.
    await db().delete(clientLetters).where(eq(clientLetters.deliveryId, late.delivery.id));
    await db().insert(clientLetters).values({ userId: late.userId, deliveryId: late.delivery.id, kind: 'thanks', client: 'Тест ООД', goods: 'Мебели', cityId: sofia.id, bonusCents: 50_00 });
    const letters = await lettersView(db(), late.userId);
    expect(letters[0]).toMatchObject({ kind: 'thanks', bonusCents: 50_00 });
    expect(letters[0]!.title).toContain('Тест ООД');
    expect(await unreadLetters(db(), late.userId)).toBe(1);
    await markLettersRead(db(), late.userId);
    expect(await unreadLetters(db(), late.userId)).toBe(0);
    const [left] = await db().select().from(clientLetters).where(and(eq(clientLetters.userId, late.userId), eq(clientLetters.deliveryId, late.delivery.id)));
    expect(left!.readAt).not.toBeNull();
  });
});

describe('1.2.3.7 „Камионът в 3D“', () => {
  it('goes live with its release', () => {
    const release = releaseByVersion('1.2.3.7')!;
    expect(FEATURES.truck_3d_view).toBe('1.2.3.7');
    expect(featureLive('truck_3d_view', new Date(release.publishedAt))).toBe(true);
    expect(featureLive('truck_3d_view', new Date(new Date(release.publishedAt).getTime() - 60_000))).toBe(false);
  });
});

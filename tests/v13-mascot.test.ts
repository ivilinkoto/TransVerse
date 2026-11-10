import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the feature as released (before the date it is staff-only).
vi.mock('@/server/features', async (load) => ({ ...(await load<typeof import('@/server/features')>()), featureFor: async () => true }));
import { cleanMascotName, favouriteTrip, MASCOT, mascotBonusCents, mascotLevel, moodNow, tripsToNext, type MascotState } from '@/lib/game/mascot';
import { closeDb } from '@/server/db/client';
import { companies, ledgerEntries, notifications } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { adoptMascot, getMascot, mascotView, petMascot, recordMascotTrip, renameMascot, setMascotAccessory } from '@/server/game/mascot';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const at = (s: string) => new Date(s);
const base: MascotState = { kind: 'dog', name: 'Шаро', trips: 0, mood: 70, moodAt: '2026-11-12T12:00:00Z', pettedAt: null, accessory: null, adoptedAt: '2026-11-12T12:00:00Z' };

describe('1.3 „Талисман“ — rules', () => {
  it('levels by trips, and the bonus grows with them', () => {
    expect(mascotLevel(0)).toBe(1);
    expect(mascotLevel(4)).toBe(1);
    expect(mascotLevel(5)).toBe(2);
    expect(mascotLevel(300)).toBe(10);
    expect(tripsToNext(7)).toEqual({ from: 5, need: 15 });
    expect(tripsToNext(400)).toBeNull();
    expect([1, 4, 7, 10].map(MASCOT.bonus)).toEqual([0.01, 0.015, 0.02, 0.03]);
  });

  it('the mood falls a step a day; a sad mascot pays nothing', () => {
    expect(moodNow(base, at('2026-11-13T11:00:00Z'))).toBe(70);
    expect(moodNow(base, at('2026-11-14T12:00:00Z'))).toBe(70 - 2 * MASCOT.mood.perIdleDay);
    expect(moodNow(base, at('2026-12-30T12:00:00Z'))).toBe(0);
    expect(mascotBonusCents(base, 100_000, false, at('2026-11-12T13:00:00Z'))).toBe(1_000);
    expect(mascotBonusCents(base, 100_000, true, at('2026-11-12T13:00:00Z'))).toBe(2_000);
    expect(mascotBonusCents(base, 100_000, true, at('2026-11-16T13:00:00Z'))).toBe(0);
  });

  it('each kind has its favourite trip', () => {
    const f = { loadedKm: 300, tons: 10, originCountry: 'BG', destCountry: 'BG', sofiaHour: 12 };
    expect(favouriteTrip('cat', { ...f, sofiaHour: 23 })).toBe(true);
    expect(favouriteTrip('cat', f)).toBe(false);
    expect(favouriteTrip('dog', { ...f, loadedKm: 850 })).toBe(true);
    expect(favouriteTrip('parrot', { ...f, destCountry: 'RO' })).toBe(true);
    expect(favouriteTrip('turtle', { ...f, tons: 24 })).toBe(true);
    expect(favouriteTrip('turtle', f)).toBe(false);
  });

  it('names are one clean line of 2–16 characters', () => {
    expect(cleanMascotName('  Мърка\n ')).toBe('Мърка');
    expect(cleanMascotName('<b>Рекс</b>')).toBe('b Рекс /b');
    expect(cleanMascotName('А')).toBeNull();
    expect(cleanMascotName('x'.repeat(40))).toHaveLength(16);
  });
});

describe('1.3 „Талисман“ — on the server', () => {
  it('adopt once, pet with a pause, accessories by level, rename', async () => {
    const p = await newPlayer();
    const now = at('2026-11-12T12:00:00+02:00');
    const st = await adoptMascot(db(), p.userId, 'cat', '  Пухчо ', now);
    expect(st).toMatchObject({ kind: 'cat', name: 'Пухчо', trips: 0, mood: MASCOT.mood.start });
    expect(await code(adoptMascot(db(), p.userId, 'dog', 'Рекс', now))).toBe('has_mascot');
    expect(await petMascot(db(), p.userId, now)).toBe(MASCOT.mood.start + MASCOT.mood.perPet);
    expect(await code(petMascot(db(), p.userId, at('2026-11-12T13:00:00+02:00')))).toBe('too_soon');
    expect(await code(petMascot(db(), p.userId, at('2026-11-12T16:30:00+02:00')))).toBe('ok');
    expect(await code(setMascotAccessory(db(), p.userId, 'scarf', now))).toBe('locked');
    expect(await code(renameMascot(db(), p.userId, 'Ч', now))).toBe('bad_name');
    expect(await renameMascot(db(), p.userId, 'Черньо', now)).toBe('Черньо');
    // Without a name the kind's own name.
    const q = await newPlayer();
    expect((await adoptMascot(db(), q.userId, 'turtle', '', now)).name).toBe('Бавко');
  });

  it('a delivery pays the share once, feeds the mascot and levels it up', async () => {
    const p = await newPlayer();
    const [account] = await db().select({ id: companies.id, balance: companies.balanceCents }).from(companies).where(eq(companies.ownerId, p.userId));
    const now = at('2026-11-12T14:00:00+02:00');
    await adoptMascot(db(), p.userId, 'dog', 'Шаро', now);
    const trip = (n: number) => ({ userId: p.userId, companyId: account!.id, deliveryId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, rewardCents: 200_000, loadedKm: n === 1 ? 900 : 200, tons: 10, originCountry: 'BG', destCountry: 'BG' });
    await db().transaction((tx) => recordMascotTrip(tx, trip(1), now));
    // The same delivery twice pays once.
    await db().transaction((tx) => recordMascotTrip(tx, trip(1), now));
    const paid = await db().select({ amount: ledgerEntries.amountCents }).from(ledgerEntries).where(and(eq(ledgerEntries.companyId, account!.id), like(ledgerEntries.idempotencyKey, '%:mascot')));
    expect(paid.map((x) => x.amount)).toEqual([4_000]); // 1% × 2 on a long trip
    for (let n = 2; n <= 5; n++) await db().transaction((tx) => recordMascotTrip(tx, trip(n), now));
    const st = (await getMascot(db(), p.userId))!;
    expect(st.trips).toBe(6);
    expect(st.mood).toBe(100);
    const view = (await mascotView(db(), p.userId, now))!;
    expect(view.level).toBe(2);
    const notes = await db().select({ href: notifications.href }).from(notifications).where(and(eq(notifications.userId, p.userId), eq(notifications.href, '/game/mascot')));
    expect(notes).toHaveLength(1);
  });

  it('a sad mascot pays nothing but cheers up with the trip', async () => {
    const p = await newPlayer();
    const [account] = await db().select({ id: companies.id }).from(companies).where(eq(companies.ownerId, p.userId));
    await adoptMascot(db(), p.userId, 'parrot', 'Коко', at('2026-11-12T12:00:00+02:00'));
    const later = at('2026-11-16T12:00:00+02:00');
    expect((await mascotView(db(), p.userId, later))!.sad).toBe(true);
    await db().transaction((tx) => recordMascotTrip(tx, { userId: p.userId, companyId: account!.id, deliveryId: '00000000-0000-4000-8000-000000000099', rewardCents: 300_000, loadedKm: 500, tons: 5, originCountry: 'BG', destCountry: 'RO' }, later));
    const paid = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, account!.id), like(ledgerEntries.idempotencyKey, '%:mascot')));
    expect(paid).toHaveLength(0);
    expect((await mascotView(db(), p.userId, later))!.mood).toBe(10 + MASCOT.mood.perTrip);
  });
});

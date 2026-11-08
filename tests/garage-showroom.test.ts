import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { UPGRADES } from '@/lib/game/catalog';
import { FEATURES, featureLive } from '@/lib/game/features';
import { TUNING_PARTS, hallTier, truckStats } from '@/lib/game/garage';
import { closeDb } from '@/server/db/client';
import { chatMessages, companies, ledgerEntries, notifications, vehicles } from '@/server/db/schema';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { buyVehicle } from '@/server/game/fleet';
import { applyTuningPreset, fitTuning, garageView, likeGarage, saveTuningPreset, shareGarage } from '@/server/game/showroom';
import { db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const balance = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!.balanceCents;

describe('1.2.3.5 the 3D garage', () => {
  it('is live now', () => {
    expect(FEATURES.garage_showroom).toBe('1.2.3.5');
    expect(featureLive('garage_showroom', new Date('2026-11-08T18:00:00+02:00'))).toBe(true);
  });

  it('the hall grows with the level; the bars follow the upgrades', () => {
    expect(hallTier(1).tier).toBe(1);
    expect(hallTier(5).tier).toBe(2);
    expect(hallTier(30).tier).toBe(3);
    const base = truckStats([], UPGRADES);
    const eco = truckStats(['eco_tune'], UPGRADES);
    expect(eco.economy).toBeGreaterThan(base.economy);
    expect(truckStats(['winter_tyres'], UPGRADES).winter).toBe(100);
  });

  it('tuning is paid once per truck; taking it off and on again is free', async () => {
    const p = await playerWithCompany('Sofia', 400_000_00);
    const v = await buyVehicle(db(), p.userId, 'danubia-t440', p.hq.id);
    const before = await balance(p.userId);
    const first = await fitTuning(db(), p.userId, v.id, 'spoiler', 'high');
    expect(first.paidCents).toBe(TUNING_PARTS.spoiler.styles.find((s) => s.id === 'high')!.priceCents);
    expect(await balance(p.userId)).toBe(before - first.paidCents);
    expect(await code(fitTuning(db(), p.userId, v.id, 'spoiler', 'high'))).toBe('already_fitted');
    await fitTuning(db(), p.userId, v.id, 'spoiler', null);
    expect((await fitTuning(db(), p.userId, v.id, 'spoiler', 'high')).paidCents).toBe(0);
    expect(await balance(p.userId)).toBe(before - first.paidCents);
    expect(await code(fitTuning(db(), p.userId, v.id, 'spoiler', 'giant'))).toBe('invalid_part');
    expect(await code(fitTuning(db(), p.userId, v.id, 'wings', 'big'))).toBe('invalid_part');
    const paid = await db().select().from(ledgerEntries).where(like(ledgerEntries.idempotencyKey, `tuning:${v.id}:%`));
    expect(paid).toHaveLength(1);
  });

  it('a van takes no roof spoiler; a rented truck takes nothing', async () => {
    const p = await playerWithCompany('Sofia', 400_000_00);
    const van = await buyVehicle(db(), p.userId, 'sokol-courier', p.hq.id);
    expect(await code(fitTuning(db(), p.userId, van.id, 'spoiler', 'low'))).toBe('not_applicable');
    expect(await code(fitTuning(db(), p.userId, van.id, 'rims', 'alloy'))).toBe('ok');
    const q = await newPlayer('Sofia');
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, q.userId));
    const [rented] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
    expect(await code(fitTuning(db(), q.userId, rented!.id, 'rims', 'alloy'))).toBe('rented');
  });

  it('a saved set comes back with the parts the truck owns only', async () => {
    const p = await playerWithCompany('Sofia', 400_000_00);
    const v = await buyVehicle(db(), p.userId, 'danubia-t440', p.hq.id);
    await fitTuning(db(), p.userId, v.id, 'rims', 'chrome');
    await fitTuning(db(), p.userId, v.id, 'exhaust', 'twin');
    expect((await saveTuningPreset(db(), p.userId, v.id, 0, '  Шоу  ')).name).toBe('Шоу');
    await fitTuning(db(), p.userId, v.id, 'rims', null);
    await fitTuning(db(), p.userId, v.id, 'exhaust', null);
    expect(await applyTuningPreset(db(), p.userId, v.id, 0)).toEqual({ missing: 0 });
    const [after] = await db().select().from(vehicles).where(eq(vehicles.id, v.id));
    expect(after!.cosmetics.tuning).toEqual({ rims: 'chrome', exhaust: 'twin' });
    // A set with a part the truck never bought: that part stays off.
    await db().update(vehicles).set({ cosmetics: { ...after!.cosmetics, presets: [{ name: 'x', tuning: { rims: 'chrome', bullbar: 'chrome' } }] } }).where(eq(vehicles.id, v.id));
    expect(await applyTuningPreset(db(), p.userId, v.id, 0)).toEqual({ missing: 1 });
    expect(await code(applyTuningPreset(db(), p.userId, v.id, 2))).toBe('no_preset');
  });

  it('visitors like the garage and leave a note; the owner hears about it once', async () => {
    const owner = await newPlayer('Sofia');
    const guest = await newPlayer('Sofia');
    const ownerName = (await garageView(db(), owner.userId, owner.userId))!.owner.username;
    expect(await code(likeGarage(db(), owner.userId, ownerName))).toBe('own_garage');
    expect((await likeGarage(db(), guest.userId, ownerName, 'Страхотен камион!')).first).toBe(true);
    expect((await likeGarage(db(), guest.userId, ownerName)).first).toBe(false);
    const view = (await garageView(db(), owner.userId, guest.userId))!;
    expect(view.likes).toBe(1);
    expect(view.liked).toBe(true);
    expect(view.mine).toBe(false);
    expect(view.notes[0]!.note).toBe('Страхотен камион!');
    const notes = await db().select().from(notifications).where(and(eq(notifications.userId, owner.userId), eq(notifications.href, '/game/showroom')));
    expect(notes).toHaveLength(1);
  });

  it('the garage goes to the global chat once in a few hours', async () => {
    const p = await newPlayer('Sofia');
    const now = new Date('2026-11-08T12:00:00Z');
    await shareGarage(db(), p.userId, now);
    expect(await code(shareGarage(db(), p.userId, new Date(now.getTime() + 3_600_000)))).toBe('too_soon');
    expect(await code(shareGarage(db(), p.userId, new Date(now.getTime() + 7 * 3_600_000)))).toBe('ok');
    const lines = await db().select().from(chatMessages).where(and(eq(chatMessages.channel, 'global'), eq(chatMessages.kind, 'garage')));
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it('the truck history counts its deliveries', async () => {
    const p = await newPlayer('Sofia');
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
    const job = await makeContract('Sofia', 'Plovdiv');
    const d = await acceptContract(db(), p.userId, job.id, truck!.id);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), acc!.id);
    const view = (await garageView(db(), p.userId, p.userId))!;
    const t = view.trucks.find((x) => x.id === truck!.id)!;
    expect(t.history.trips).toBe(1);
    expect(t.history.favouriteCity).toBe('Пловдив');
    expect(t.history.longestKm).toBeGreaterThan(100);
  });
});

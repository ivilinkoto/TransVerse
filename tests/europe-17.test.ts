import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// Before the release of 1.7 ("Цяла Европа" is off), except where a test turns it on.
const live = vi.hoisted(() => ({ europe: false }));
vi.mock('@/lib/game/features', async (load) => {
  const real = await load<typeof import('@/lib/game/features')>();
  return { ...real, featureLive: (id: string, now?: Date, staff?: boolean) => (id === 'europe' ? live.europe || !!staff : true) };
});
import { CROSSING_LINES, ISLANDS, islandOf } from '@/lib/game/crossings';
import { NON_EU, requiredLicences } from '@/lib/game/licences';
import { NATIONAL_DAYS } from '@/lib/game/spring';
import { EUROPE_COUNTRIES, GAME_COUNTRIES, isEuropeCountry } from '@/lib/geo/scope';
import { closeDb } from '@/server/db/client';
import { cities, companies, users, vehicles } from '@/server/db/schema';
import { loadHubs, openContracts } from '@/server/game/contracts';
import { acceptContract } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { db, grantLicences, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));

describe('the data of "Цяла Европа"', () => {
  it('26 countries with cities; every country has a national day; non-EU ones need customs', async () => {
    const rows = await db().execute<{ code: string; n: number }>(sql`select country_code as code, count(*)::int as n from cities group by country_code`);
    const have = new Map(rows.rows.map((r) => [r.code, r.n]));
    for (const c of GAME_COUNTRIES) expect(have.get(c) ?? 0, c).toBeGreaterThan(0);
    for (const c of GAME_COUNTRIES) expect(NATIONAL_DAYS[c], c).toBeDefined();
    expect(requiredLicences('pallets', ['IT', 'CH'])).toContain('customs');
    expect(requiredLicences('pallets', ['IT', 'FR'])).not.toContain('customs');
    expect(NON_EU.has('AL')).toBe(true);
  });

  it('no city out of reach is in the game; every island city has a ferry to the mainland', async () => {
    const far = await db().select({ name: cities.name }).from(cities).where(sql`(${cities.countryCode} in ('ES','PT') and ${cities.lon} < -10) or (${cities.countryCode} = 'ES' and ${cities.lat} < 35.95)`);
    expect(far).toEqual([]);
    for (const island of ISLANDS) for (const id of island.lines) expect(CROSSING_LINES.find((l) => l.id === id), id).toBeDefined();
    const [palermo] = await db().select().from(cities).where(eq(cities.name, 'Palermo'));
    expect(islandOf(palermo!)?.id).toBe('sicily');
    const [reggio] = await db().select().from(cities).where(eq(cities.name, 'Reggio Calabria'));
    expect(islandOf(reggio!)).toBeNull();
  });
});

describe('before the release', () => {
  it('the hubs, the board and taking a load leave the new countries to the staff', async () => {
    live.europe = false;
    expect((await loadHubs(db())).some((h) => isEuropeCountry(h.countryCode))).toBe(false);
    expect((await loadHubs(db(), { europe: true })).some((h) => isEuropeCountry(h.countryCode))).toBe(true);
    const c = await makeContract('Vienna', 'Milan', { windowMinutes: 3 * 24 * 60 });
    expect((await openContracts(db(), { limit: 300 })).some((x) => x.id === c.id)).toBe(false);
    expect((await openContracts(db(), { limit: 300, withEurope: true })).some((x) => x.id === c.id)).toBe(true);
    const p = await newPlayer();
    await grantLicences(p.userId, 'international', 'customs');
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
    expect(await code(acceptContract(db(), p.userId, c.id, truck!.id))).toBe('not_released');
    const staff = await newPlayer();
    await grantLicences(staff.userId, 'international', 'customs');
    await db().update(users).set({ role: 'admin' }).where(eq(users.id, staff.userId));
    const [acc2] = await db().select().from(companies).where(eq(companies.ownerId, staff.userId));
    const [truck2] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc2!.id));
    expect(await code(acceptContract(db(), staff.userId, c.id, truck2!.id))).toBe('ok');
    expect(EUROPE_COUNTRIES).toHaveLength(17);
  });
});

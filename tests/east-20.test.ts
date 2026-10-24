import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// Before the release of 2.0 (the east is off), except where a test turns it on.
const live = vi.hoisted(() => ({ openWorld: false }));
vi.mock('@/lib/game/features', async (load) => {
  const real = await load<typeof import('@/lib/game/features')>();
  return { ...real, featureLive: (id: string, now?: Date, staff?: boolean) => (id === 'open_world' ? live.openWorld || !!staff : true) };
});
import { closedCrossing, detourFor, isClosedBorder } from '@/lib/geo/borders';
import { NON_EU, requiredLicences } from '@/lib/game/licences';
import { NATIONAL_DAYS } from '@/lib/game/spring';
import { countryOpen, EAST_COUNTRIES, isEastCountry, playableCountries } from '@/lib/geo/scope';
import { closeDb } from '@/server/db/client';
import { cities, companies, users, vehicles } from '@/server/db/schema';
import { loadHubs, openContracts } from '@/server/game/contracts';
import { acceptContract } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { nationalBoard, nationalTable } from '@/server/game/queries';
import { approximateProvider, routeOpen, RoutingUnavailableError, type RoutingProvider } from '@/server/geo/routing';
import { db, grantLicences, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const point = async (name: string) => {
  const [c] = await db().select().from(cities).where(eq(cities.name, name));
  return { lat: c!.lat, lon: c!.lon, country: c!.countryCode };
};

describe('v2.0: the east of Europe and the Caucasus', () => {
  it('nine new countries with cities, a national day and customs outside the EU', async () => {
    const rows = await db().execute<{ code: string; n: number }>(sql`select country_code as code, count(*)::int as n from cities group by country_code`);
    const have = new Map(rows.rows.map((r) => [r.code, r.n]));
    for (const c of EAST_COUNTRIES) expect(have.get(c) ?? 0, c).toBeGreaterThan(0);
    for (const c of EAST_COUNTRIES) expect(NATIONAL_DAYS[c], c).toBeDefined();
    expect(requiredLicences('pallets', ['UA', 'PL'])).toContain('customs');
    expect(requiredLicences('pallets', ['LT', 'LV'])).not.toContain('customs');
    expect(NON_EU.has('EE')).toBe(false);
  });

  it('only European Russia; no city in the war zones or the breakaway regions; Bulgarian names', async () => {
    expect(await db().select({ name: cities.name }).from(cities).where(sql`${cities.countryCode} = 'RU' and ${cities.lon} >= 60`)).toEqual([]);
    // (Donetsk in the Rostov region of Russia is another town.)
    for (const name of ['Simferopol', 'Sevastopol', 'Donetsk', 'Luhansk', 'Mariupol', 'Melitopol', 'Sokhumi', 'Ts’khinvali']) expect(await db().select().from(cities).where(and(eq(cities.name, name), sql`${cities.countryCode} in ('UA', 'GE')`)), name).toEqual([]);
    const [kyiv] = await db().select().from(cities).where(eq(cities.name, 'Kyiv'));
    expect(kyiv!.nameBg).toBe('Киев');
    const [nn] = await db().select().from(cities).where(eq(cities.name, 'Nizhniy Novgorod'));
    expect(nn!.nameBg).toBe('Нижни Новгород');
  });
});

describe('closed borders', () => {
  it('Ukraine–Russia, Ukraine–Belarus and Armenia–Turkey are closed; the rest are open', () => {
    expect(isClosedBorder('UA', 'RU')).toBe(true);
    expect(isClosedBorder('BY', 'UA')).toBe(true);
    expect(isClosedBorder('TR', 'AM')).toBe(true);
    expect(isClosedBorder('UA', 'PL')).toBe(false);
    expect(isClosedBorder('GE', 'RU')).toBe(false);
    expect(detourFor('RU', 'UA').map((w) => `${w.from}>${w.to}`)).toEqual(['BY>PL', 'PL>UA']);
  });

  it('a route goes round a closed border through the open crossings', async () => {
    const kyivMinsk = await routeOpen(approximateProvider, await point('Kyiv'), await point('Minsk'), 'truck');
    expect(kyivMinsk.borders.map((b) => `${b.from}>${b.to}`)).toEqual(['UA>PL', 'PL>BY']);
    const kyivMoscow = await routeOpen(approximateProvider, await point('Kyiv'), await point('Moscow'), 'truck');
    expect(kyivMoscow.borders.map((b) => `${b.from}>${b.to}`)).toEqual(['UA>PL', 'PL>BY', 'BY>RU']);
    expect(kyivMoscow.countries).toEqual(['UA', 'PL', 'BY', 'RU']);
    const yerevanIstanbul = await routeOpen(approximateProvider, await point('Yerevan'), await point('Istanbul'), 'truck');
    expect(closedCrossing(yerevanIstanbul.borders)).toBeNull();
    expect(yerevanIstanbul.countries).toEqual(['AM', 'GE', 'TR']);
    // Longer than straight through, and the kilometres stay in order.
    const direct = await approximateProvider.route(await point('Kyiv'), await point('Moscow'), 'truck');
    expect(kyivMoscow.distanceKm).toBeGreaterThan(direct.distanceKm);
    expect(kyivMoscow.borders.map((b) => b.km)).toEqual([...kyivMoscow.borders.map((b) => b.km)].sort((a, b) => a - b));
  });

  it('a provider that still crosses a closed border is treated as unavailable', async () => {
    const stubborn: RoutingProvider = { name: 'valhalla', route: async (from, to, profile) => ({ ...(await approximateProvider.route(from, to, profile)), provider: 'valhalla' }) };
    await expect(routeOpen(stubborn, await point('Kyiv'), await point('Minsk'), 'truck')).rejects.toBeInstanceOf(RoutingUnavailableError);
  });
});

describe('before the release', () => {
  it('the hubs, the board and taking a load leave the east to the staff', async () => {
    live.openWorld = false;
    expect(playableCountries(true).some(isEastCountry)).toBe(false);
    expect(playableCountries(true, true).filter(isEastCountry)).toHaveLength(9);
    expect(countryOpen('UA', true, false)).toBe(false);
    expect((await loadHubs(db())).some((h) => isEastCountry(h.countryCode))).toBe(false);
    expect((await loadHubs(db(), { openWorld: true })).some((h) => isEastCountry(h.countryCode))).toBe(true);
    const c = await makeContract('Chisinau', 'Bucharest', { windowMinutes: 3 * 24 * 60 });
    expect((await openContracts(db(), { limit: 300 })).some((x) => x.id === c.id)).toBe(false);
    expect((await openContracts(db(), { limit: 300, withOpenWorld: true })).some((x) => x.id === c.id)).toBe(true);
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
    expect(await code(acceptContract(db(), staff.userId, c.id, truck2!.id))).not.toBe('not_released');
  });
});

describe('national rankings', () => {
  it('the countries by their companies’ season points, and one country’s companies', async () => {
    const { rows } = await nationalTable(db());
    expect(rows.every((r, i) => i === 0 || rows[i - 1]!.points >= r.points)).toBe(true);
    const bg = await nationalBoard(db(), 'BG');
    expect(bg.rows.every((r, i) => i === 0 || bg.rows[i - 1]!.value >= r.value)).toBe(true);
  });
});

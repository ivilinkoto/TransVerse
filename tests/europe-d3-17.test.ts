import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { GRAND_EUROTOUR } from '@/lib/game/challenges';
import { COUNTRY_KINGS } from '@/lib/game/europe';
import { EVENT_TEMPLATES, pickTemplate, REGIONAL_EVENT_TEMPLATES } from '@/lib/game/events';
import { closeDb } from '@/server/db/client';
import { cities, companies, countryKings, deliveries, userBadges, users, vehicles } from '@/server/db/schema';
import { runCommand } from '@/server/discord/commands';
import { checkGrandEurotour, grandEurotourProgress } from '@/server/game/challenges';
import { countryInfo, findCountry } from '@/server/game/countries';
import { acceptContract } from '@/server/game/deliveries';
import { kingdomsOf, settleCountryKings } from '@/server/game/kings';
import { activeSeason } from '@/server/game/seasons';
import { db, grantLicences, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const truckOf = async (userId: string) => (await db().select().from(vehicles).where(eq(vehicles.companyId, (await accountOf(userId)).id)))[0]!;

/** A delivery the player took (on the road), and a way to copy it as completed trips to other cities. */
async function tripsOf(userId: string) {
  await grantLicences(userId, 'international', 'customs');
  const first = await makeContract('Sofia', 'Plovdiv');
  const d = await acceptContract(db(), userId, first.id, (await truckOf(userId)).id);
  const [row] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
  return async (to: string, completedAt: Date, weightTons = 1) => {
    const c = await makeContract('Sofia', to, { weightTons });
    const { id: _id, ...rest } = row!;
    await db().insert(deliveries).values({ ...rest, contractId: c.id, status: 'completed', completedAt, late: false });
  };
}

describe('v1.7 D3', () => {
  it('regional events join the rotation only when the feature is on', () => {
    const regional = new Set(REGIONAL_EVENT_TEMPLATES.map((t) => t.id));
    const starts = Array.from({ length: 200 }, (_, i) => new Date(Date.UTC(2027, 3, 1) + i * 92 * 3_600_000));
    expect(starts.some((s) => regional.has(pickTemplate(s, null, true).id))).toBe(true);
    expect(starts.every((s) => !regional.has(pickTemplate(s, null, false).id))).toBe(true);
    expect(REGIONAL_EVENT_TEMPLATES.every((t) => t.countryCode)).toBe(true);
    expect(new Set([...EVENT_TEMPLATES, ...REGIONAL_EVENT_TEMPLATES].map((t) => t.id)).size).toBe(EVENT_TEMPLATES.length + REGIONAL_EVENT_TEMPLATES.length);
  });

  it('Голям евротур: every country of the game in one season — a badge and ТрансКоин, once', async () => {
    const p = await newPlayer();
    const now = new Date();
    await activeSeason(db(), new Date(now.getTime() - 60_000));
    const trip = await tripsOf(p.userId);
    const biggest = await db().execute<{ code: string; name: string }>(sql`select distinct on (country_code) country_code as code, name from ${cities} order by country_code, population desc`);
    const byCountry = new Map(biggest.rows.map((r) => [r.code, r.name]));
    const last = GRAND_EUROTOUR.countries.at(-1)!;
    for (const code of GRAND_EUROTOUR.countries) if (code !== last) await trip(byCountry.get(code)!, now);
    const { countries: list } = await grandEurotourProgress(db(), p.userId, now);
    expect(list.filter((c) => !c.done).map((c) => c.code)).toEqual([last]);
    const coins0 = (await db().select().from(users).where(eq(users.id, p.userId)))[0]!.coins;
    await trip(byCountry.get(last)!, now);
    expect(await db().transaction((tx) => checkGrandEurotour(tx, p.userId, last, now))).toBe(true);
    expect(await db().transaction((tx) => checkGrandEurotour(tx, p.userId, last, now))).toBe(false);
    expect((await db().select().from(users).where(eq(users.id, p.userId)))[0]!.coins).toBe(coins0 + GRAND_EUROTOUR.coins);
    expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, p.userId), eq(userBadges.badge, GRAND_EUROTOUR.badge)))).toHaveLength(1);
  });

  it('the king of a country: most tons last month, at least the minimum, crowned once', async () => {
    const [a, b] = [await newPlayer(), await newPlayer()];
    const [tripA, tripB] = [await tripsOf(a.userId), await tripsOf(b.userId)];
    // March 2031 (Sofia): a brings 30 t to Italy, b 22 t; b alone brings 5 t to Spain (below the minimum).
    const march = new Date('2031-03-15T10:00:00Z');
    await tripA('Rome', march, 18);
    await tripA('Milan', march, 12);
    await tripB('Rome', march, 22);
    await tripB('Madrid', march, 5);
    const coins0 = (await db().select().from(users).where(eq(users.id, a.userId)))[0]!.coins;
    const april = new Date('2031-04-01T03:00:00Z');
    const res = await settleCountryKings(db(), april);
    expect(res?.month).toBe('M2031-03');
    expect(await settleCountryKings(db(), april)).toBeNull();
    const kings = await db().select().from(countryKings).where(eq(countryKings.month, 'M2031-03'));
    expect(kings.find((k) => k.countryCode === 'IT')).toMatchObject({ userId: a.userId, tons: 30 });
    expect(kings.find((k) => k.countryCode === 'ES')).toBeUndefined();
    expect((await db().select().from(users).where(eq(users.id, a.userId)))[0]!.coins).toBe(coins0 + COUNTRY_KINGS.coins);
    expect((await kingdomsOf(db(), a.userId)).map((k) => k.countryCode)).toContain('IT');
    expect(await kingdomsOf(db(), b.userId)).toEqual([]);
  });

  it('a country in short, and /държава in Discord', async () => {
    expect(await findCountry(db(), 'италия')).toBe('IT');
    expect(await findCountry(db(), 'CH')).toBe('CH');
    expect(await findCountry(db(), 'Атлантида')).toBeNull();
    const ch = (await countryInfo(db(), 'CH', new Date()))!;
    expect(ch.ban).toMatch(/неделя/);
    expect(ch.toll.kind).toBe('km');
    expect((await countryInfo(db(), 'RO', new Date()))!.toll.kind).toBe('vignette');
    expect((await countryInfo(db(), 'FR', new Date()))!.zones).toEqual(expect.arrayContaining(['Париж']));
    const reply = await runCommand(db(), { name: 'държава', options: { име: 'Италия' }, discordUserId: 'nobody' });
    expect(reply.embeds?.[0]?.title).toContain('Италия');
    expect((await runCommand(db(), { name: 'държава', options: { име: 'Атлантида' }, discordUserId: 'nobody' })).ephemeral).toBe(true);
  });
});

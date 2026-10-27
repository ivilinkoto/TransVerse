import { createHash } from 'node:crypto';
import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { COMPANY_RENAME_DAYS, ALL_PERMISSIONS } from '@/lib/game/company';
import { FEATURES } from '@/lib/game/features';
import { signupSchema } from '@/server/auth/accounts';
import { clearLoginFailures, issueCaptcha, loginNeedsCaptcha, recordLoginFailure, verifyCaptcha } from '@/server/auth/captcha';
import { changeEmail } from '@/server/auth/password-change';
import { CAPTCHA } from '@/lib/captcha';
import { securitySignals } from '@/server/admin-economy';
import { newPlayerFunnel } from '@/server/admin';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { notifyArrivingSoon, weeklyNumbers } from '@/server/game/heads-up';
import { playerCard, setFavoriteTruck } from '@/server/game/social';
import { testsUnreleased } from '@/server/auth/roles';
import { closeDb } from '@/server/db/client';
import { companies, companyChronicle, contracts, deliveries, depots, drivers, notifications, organizations, users, vehicles } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { GameError } from '@/server/game/errors';
import { joinCompany, membershipOf, renameCompany, requirePermission, transferOwnership } from '@/server/game/membership';
import { acceptTerms, setUiPrefs } from '@/server/game/ui-prefs';
import { cityByName, db, makeContract, newPlayer, playerWithCompany } from './helpers';
import { truckBlock } from '@/lib/game/truck-ready';
import { LOCAL_JOBS } from '@/lib/game/local-jobs';
import { buyDepot } from '@/server/game/fleet';
import { autoDispatchTick, setAutoDispatch } from '@/server/game/dispatch';
import { ensureLocalJobsForFleet } from '@/server/game/contracts';
import { approximateProvider } from '@/server/geo/routing';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const companyWithHeir = async () => {
  const owner = await playerWithCompany();
  const [org] = await db().select().from(organizations).where(eq(organizations.ownerId, owner.userId));
  await db().update(organizations).set({ recruitment: 'open', minJoinLevel: 1 }).where(eq(organizations.id, org!.id));
  const heir = await newPlayer();
  await joinCompany(db(), heir.userId, org!.id);
  const [u] = await db().select({ username: users.username }).from(users).where(eq(users.id, heir.userId));
  return { owner, org: org!, heir, heirName: u!.username };
};
const solve = (p: { salt: string; challenge: string; max: number }) => {
  for (let n = 0; n < p.max; n++) if (createHash('sha256').update(`${p.salt}${n}`).digest('hex') === p.challenge) return n;
  return -1;
};

describe('v1.1.2 fixes', () => {
  it('cabotage is no longer a feature', () => {
    expect('cabotage' in FEATURES).toBe(false);
  });

  it('the heir of a company holds every right, the old owner no more than a deputy', async () => {
    const { owner, heir, heirName } = await companyWithHeir();
    await transferOwnership(db(), owner.userId, heir.userId, false, heirName.toUpperCase());

    const m = await membershipOf(db(), heir.userId);
    expect(m!.rank.isOwner).toBe(true);
    for (const p of ALL_PERMISSIONS) await db().transaction((tx) => requirePermission(tx, heir.userId, p));
    const old = await membershipOf(db(), owner.userId);
    expect(old!.rank.isOwner).toBe(false);
  });

  it('handing over needs the heir name typed right', async () => {
    const { owner, heir } = await companyWithHeir();
    expect(await code(transferOwnership(db(), owner.userId, heir.userId, false, 'someone else'))).toBe('confirm_mismatch');
    expect((await membershipOf(db(), owner.userId))!.rank.isOwner).toBe(true);
  });
});

describe('v1.1.2 sign-up', () => {
  const base = { email: 'a@example.com', username: 'abc', password: 'secret1', passwordConfirm: 'secret1', startCityId: 1, acceptTerms: true, captcha: { id: '00000000-0000-4000-8000-000000000000', number: 1 } };

  it('asks for the same password twice, the terms and the captcha', () => {
    expect(signupSchema.safeParse(base).success).toBe(true);
    expect(signupSchema.safeParse({ ...base, passwordConfirm: 'secret2' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, acceptTerms: false }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, captcha: undefined }).success).toBe(false);
  });

  it('a captcha is solved once: the right number passes, a replay or a wrong number fails', async () => {
    const p = await issueCaptcha(db());
    const n = solve(p);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(await code(verifyCaptcha(db(), { id: p.id, number: n }))).toBe('ok');
    expect(await code(verifyCaptcha(db(), { id: p.id, number: n }))).toBe('captcha_failed');
    const q = await issueCaptcha(db());
    expect(await code(verifyCaptcha(db(), { id: q.id, number: (solve(q) + 1) % q.max }))).toBe('captcha_failed');
    // An expired puzzle fails even with the right number.
    const r = await issueCaptcha(db(), new Date(Date.now() - 3_600_000));
    expect(await code(verifyCaptcha(db(), { id: r.id, number: solve(r) }))).toBe('captcha_failed');
  });
});

describe('v1.1.2 small features', () => {
  it('the owner renames the company once per period; others cannot', async () => {
    const { owner, heir, org } = await companyWithHeir();
    const now = new Date();
    expect(await code(renameCompany(db(), heir.userId, 'Чуждо име', now))).toBe('forbidden');
    const name = `Ново ${org.id.slice(0, 8)}`;
    await renameCompany(db(), owner.userId, name, now);
    expect((await db().select().from(organizations).where(eq(organizations.id, org.id)))[0]!.name).toBe(name);
    expect(await code(renameCompany(db(), owner.userId, `${name} 2`, new Date(now.getTime() + 86_400_000)))).toBe('too_soon');
    expect(await code(renameCompany(db(), owner.userId, `${name} 2`, new Date(now.getTime() + (COMPANY_RENAME_DAYS + 1) * 86_400_000)))).toBe('ok');
  });

  it('a staff member looking as a player gets the features of a player', async () => {
    const p = await newPlayer();
    await db().update(users).set({ role: 'support' }).where(eq(users.id, p.userId));
    const unreleased = (Object.keys(FEATURES) as (keyof typeof FEATURES)[]).find((id) => FEATURES[id] === '2.0')!;
    expect(await featureFor(db(), p.userId, unreleased)).toBe(true);
    await setUiPrefs(db(), p.userId, { asPlayer: true });
    // A fresh connection object: featureFor caches the answer per connection.
    await db().transaction(async (tx) => expect(await featureFor(tx, p.userId, unreleased)).toBe(false));
    expect(testsUnreleased({ role: 'admin', uiPrefs: { asPlayer: true } })).toBe(false);
    expect(testsUnreleased({ role: 'admin' })).toBe(true);
    expect(testsUnreleased({ role: 'player' })).toBe(false);
  });
});

describe('v1.1.2 account and safety', () => {
  it('the login asks for the captcha after a few wrong passwords, and forgets them after a good one', async () => {
    const ip = `test-${Date.now()}`;
    expect(await loginNeedsCaptcha(db(), ip, 'Someone')).toBe(false);
    for (let i = 0; i < CAPTCHA.loginAfter; i++) await recordLoginFailure(db(), ip, 'Someone');
    expect(await loginNeedsCaptcha(db(), ip, 'someone')).toBe(true);
    // Another address trying the same account is asked too.
    expect(await loginNeedsCaptcha(db(), `${ip}-2`, 'someone')).toBe(true);
    await clearLoginFailures(db(), ip, 'someone');
    expect(await loginNeedsCaptcha(db(), ip, 'someone')).toBe(false);
  });

  it('the e-mail changes only with the right password, to a free address, and must be confirmed again', async () => {
    const p = await newPlayer();
    const other = await newPlayer();
    const [o] = await db().select({ email: users.email }).from(users).where(eq(users.id, other.userId));
    await db().update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, p.userId));
    expect(await code(changeEmail(db(), p.userId, { password: 'wrong', email: 'new@example.com' }))).toBe('invalid_password');
    expect(await code(changeEmail(db(), p.userId, { password: 'correct horse battery', email: o!.email }))).toBe('already_registered');
    const fresh = `n${Date.now()}@example.com`;
    await changeEmail(db(), p.userId, { password: 'correct horse battery', email: fresh });
    const [u] = await db().select().from(users).where(eq(users.id, p.userId));
    expect(u!.email).toBe(fresh);
    expect(u!.emailVerifiedAt).toBeNull();
  });

  it('old accounts accept the terms once', async () => {
    const p = await newPlayer();
    const at = new Date('2026-11-01T10:00:00Z');
    await acceptTerms(db(), p.userId, at);
    await acceptTerms(db(), p.userId, new Date('2026-12-01T10:00:00Z'));
    const [u] = await db().select({ at: users.termsAcceptedAt }).from(users).where(eq(users.id, p.userId));
    expect(u!.at!.toISOString()).toBe(at.toISOString());
  });
});

describe('v1.1.2 player features', () => {
  const after = new Date('2026-11-02T08:00:00Z');

  it('"пристига след 5 мин" comes once, only for long trips', async () => {
    const p = await newPlayer();
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [van] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
    const contract = await makeContract('Sofia', 'Plovdiv');
    const d = await acceptContract(db(), p.userId, contract.id, van!.id);
    await db().update(deliveries).set({ startedAt: new Date(after.getTime() - 40 * 60_000), etaAt: new Date(after.getTime() + 3 * 60_000) }).where(eq(deliveries.id, d.id));
    const count = async () => (await db().select().from(notifications).where(and(eq(notifications.userId, p.userId), like(notifications.href, '/game/contracts?from=%&truck=%')))).length;
    await notifyArrivingSoon(db(), after);
    await notifyArrivingSoon(db(), after);
    expect(await count()).toBe(1);
  });

  it('the weekly report counts the week of every driver who drove', async () => {
    const p = await newPlayer();
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [van] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
    const contract = await makeContract('Sofia', 'Pernik', { rewardCents: 300_00 });
    const d = await acceptContract(db(), p.userId, contract.id, van!.id);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), account!.id);
    const mine = (await weeklyNumbers(db(), new Date(d.etaAt.getTime() + 3_600_000))).find((r) => r.userId === p.userId);
    expect(mine?.trips).toBe(1);
    expect(mine?.earnedCents).toBe(300_00);
    expect(mine!.place).toBeGreaterThanOrEqual(1);
  });

  it('the favourite truck is one of the player own and shows on their card', async () => {
    const p = await newPlayer();
    const other = await newPlayer();
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [otherAccount] = await db().select().from(companies).where(eq(companies.ownerId, other.userId));
    const [van] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
    const [foreign] = await db().select().from(vehicles).where(eq(vehicles.companyId, otherAccount!.id));
    expect(await code(setFavoriteTruck(db(), p.userId, foreign!.id))).toBe('vehicle_not_found');
    await setFavoriteTruck(db(), p.userId, van!.id);
    const card = await playerCard(db(), other.userId, p.username, after);
    expect(card?.favorite?.plate).toBe(van!.plate);
  });

  it('a rename is written to the company chronicle', async () => {
    const { owner, org } = await companyWithHeir();
    await renameCompany(db(), owner.userId, `Хроника ${org.id.slice(0, 6)}`);
    const rows = await db().select().from(companyChronicle).where(and(eq(companyChronicle.organizationId, org.id), eq(companyChronicle.kind, 'name')));
    expect(rows.length).toBe(1);
  });

  it('the staff see sign-up bursts and the new players funnel', async () => {
    const signals = await securitySignals(db());
    expect(Array.isArray(signals.bursts) && Array.isArray(signals.captcha) && Array.isArray(signals.logins)).toBe(true);
    const funnel = await newPlayerFunnel(db());
    expect(funnel.week).toBeGreaterThan(0);
    expect(funnel.first).toBeLessThanOrEqual(funnel.week);
  });
});

describe('v1.1.2 never stuck without a load', () => {
  const base = { id: 'v1', status: 'idle', condition: 90, model: { kind: 'rigid' }, trailer: null, driver: {}, delivery: null };
  const now = new Date('2026-11-01T10:00:00Z');

  it('says why a free truck cannot take any load, and where to fix it', () => {
    expect(truckBlock(base, now)).toBeNull();
    expect(truckBlock({ ...base, driver: null }, now)?.href).toBe('/game/staff');
    expect(truckBlock({ ...base, status: 'listed' }, now)?.href).toBe('/game/garage');
    expect(truckBlock({ ...base, model: { kind: 'tractor' } }, now)?.href).toBe('/game/fleet');
    expect(truckBlock({ ...base, condition: 10 }, now)?.reason).toContain('ремонт');
    expect(truckBlock({ ...base, driver: { vacationUntil: new Date(now.getTime() + 3_600_000) } }, now)?.href).toBe('/game/staff');
    // On a trip nothing is wrong.
    expect(truckBlock({ ...base, driver: null, delivery: {} }, now)).toBeNull();
  });

  it('a load another company holds does not count as the free truck own job', async () => {
    const p = await newPlayer();
    const rival = await newPlayer();
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [rivalAccount] = await db().select().from(companies).where(eq(companies.ownerId, rival.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
    const town = await cityByName('Vidin');
    await db().update(contracts).set({ status: 'expired' }).where(and(eq(contracts.originCityId, town.id), eq(contracts.status, 'open')));
    await db().update(vehicles).set({ cityId: town.id }).where(eq(vehicles.id, truck!.id));
    expect(await ensureLocalJobsForFleet(db(), new Date(), account!.id, approximateProvider)).toBe(3);
    // Another company holds them: the truck gets new ones.
    await db().update(contracts).set({ reservedByCompanyId: rivalAccount!.id, reservedUntil: new Date(Date.now() + 3_600_000) }).where(and(eq(contracts.originCityId, town.id), eq(contracts.status, 'open')));
    expect(await ensureLocalJobsForFleet(db(), new Date(), account!.id, approximateProvider)).toBe(3);
    // Held by the player's own company it counts.
    await db().update(contracts).set({ reservedByCompanyId: account!.id }).where(and(eq(contracts.originCityId, town.id), eq(contracts.status, 'open')));
    expect(await ensureLocalJobsForFleet(db(), new Date(), account!.id, approximateProvider)).toBe(0);
  });
});

describe('v1.1.2 VIP dispatcher tells why it waits', () => {
  it('a truck it cannot send gets a note and one notification; once it can, it goes and the note clears', async () => {
    const p = await newPlayer();
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
    await db().update(users).set({ vipUntil: new Date(Date.now() + 86_400_000) }).where(eq(users.id, p.userId));
    await setAutoDispatch(db(), p.userId, truck!.id, true);
    const [driver] = await db().select().from(drivers).where(eq(drivers.vehicleId, truck!.id));
    await db().update(drivers).set({ vehicleId: null }).where(eq(drivers.id, driver!.id));

    await autoDispatchTick(db());
    await autoDispatchTick(db());
    const [v] = await db().select().from(vehicles).where(eq(vehicles.id, truck!.id));
    expect(v!.autoDispatchNote).toBe('Няма назначен шофьор.');
    const notes = await db().select().from(notifications).where(and(eq(notifications.userId, p.userId), like(notifications.title, '%VIP%')));
    expect(notes).toHaveLength(1);

    await db().update(drivers).set({ vehicleId: truck!.id }).where(eq(drivers.id, driver!.id));
    await makeContract('Sofia', 'Plovdiv', { weightTons: 2, rewardCents: 2_000_00 });
    expect(await autoDispatchTick(db())).toBeGreaterThanOrEqual(1);
    const [after] = await db().select().from(vehicles).where(eq(vehicles.id, truck!.id));
    expect(after!.autoDispatchNote).toBeNull();
    expect(after!.status).toBe('on_delivery');
  });
});

describe('v1.1.2 loads wait where the trucks are', () => {
  it('a truck arriving within the hour already finds loads at its destination', async () => {
    const p = await newPlayer();
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
    const town = await cityByName('Vidin');
    await db().update(contracts).set({ status: 'expired' }).where(and(eq(contracts.originCityId, town.id), eq(contracts.status, 'open')));
    const load = await makeContract('Sofia', 'Vidin');
    const d = await acceptContract(db(), p.userId, load.id, truck!.id);
    const now = new Date(d.etaAt.getTime() - 30 * 60_000);
    expect(await ensureLocalJobsForFleet(db(), now, account!.id, approximateProvider)).toBeGreaterThanOrEqual(LOCAL_JOBS.perTruck);
    const waiting = await db().select().from(contracts).where(and(eq(contracts.originCityId, town.id), eq(contracts.status, 'open')));
    expect(waiting.length).toBeGreaterThanOrEqual(LOCAL_JOBS.perTruck);
  });
});

describe('v1.1.2 the first depot is free', () => {
  it('a new player has a depot in the start city; one without depots opens the first for free, the next one costs', async () => {
    const p = await newPlayer('Varna');
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const mine = await db().select().from(depots).where(eq(depots.companyId, account!.id));
    expect(mine.map((d) => d.cityId)).toEqual([p.hq.id]);

    // A player from before: no depot at all.
    await db().delete(depots).where(eq(depots.companyId, account!.id));
    const plovdiv = await cityByName('Plovdiv');
    const before = (await db().select().from(companies).where(eq(companies.id, account!.id)))[0]!.balanceCents;
    await buyDepot(db(), p.userId, plovdiv.id);
    expect((await db().select().from(companies).where(eq(companies.id, account!.id)))[0]!.balanceCents).toBe(before);
    // The second one is paid (and needs the money).
    expect(await code(buyDepot(db(), p.userId, p.hq.id))).toBe('insufficient_funds');
  });
});

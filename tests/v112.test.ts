import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { COMPANY_RENAME_DAYS, ALL_PERMISSIONS } from '@/lib/game/company';
import { FEATURES } from '@/lib/game/features';
import { signupSchema } from '@/server/auth/accounts';
import { issueCaptcha, verifyCaptcha } from '@/server/auth/captcha';
import { testsUnreleased } from '@/server/auth/roles';
import { closeDb } from '@/server/db/client';
import { organizations, users } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { GameError } from '@/server/game/errors';
import { joinCompany, membershipOf, renameCompany, requirePermission, transferOwnership } from '@/server/game/membership';
import { setUiPrefs } from '@/server/game/ui-prefs';
import { db, newPlayer, playerWithCompany } from './helpers';

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

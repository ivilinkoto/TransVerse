import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { FEATURES } from '@/lib/game/features';
import { COMPANY_BOOST } from '@/lib/game/speed-up';
import { closeDb } from '@/server/db/client';
import { companies, ledgerEntries, users, vehicles } from '@/server/db/schema';
import { postCoins } from '@/server/game/coins';
import { buyCompanyBoost, companyBoostUntil } from '@/server/game/company-boost';
import { acceptContract } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { membershipOf } from '@/server/game/membership';
import { speedUpDelivery } from '@/server/game/speed-up';
import { db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const coins = async (userId: string) => (await db().select({ c: users.coins }).from(users).where(eq(users.id, userId)))[0]!.c;
const give = (userId: string, n: number) => db().transaction((tx) => postCoins(tx, userId, { amount: n, reason: 'purchase', description: 'test', idempotencyKey: `cb-coins:${userId}:${n}` }));

describe('1.3.2.2: the company booster', () => {
  it('needs a company and the coins; runs 24 h and is extended when bought again', async () => {
    expect(FEATURES.company_boost).toBe('1.3.2.2');
    const solo = await newPlayer();
    await give(solo.userId, 2_000);
    expect(await code(buyCompanyBoost(db(), solo.userId, new Date()))).toBe('no_company');
    const p = await playerWithCompany();
    expect(await code(buyCompanyBoost(db(), p.userId, new Date()))).toBe('insufficient_coins');
    await give(p.userId, 2_000);
    const now = new Date();
    const first = await buyCompanyBoost(db(), p.userId, now);
    expect(first.getTime() - now.getTime()).toBe(COMPANY_BOOST.hours * 3_600_000);
    const second = await buyCompanyBoost(db(), p.userId, new Date(now.getTime() + 1000));
    expect(second.getTime() - first.getTime()).toBe(COMPANY_BOOST.hours * 3_600_000);
    expect(await coins(p.userId)).toBe(2_000 - 2 * COMPANY_BOOST.coins);
    const m = await membershipOf(db(), p.userId);
    expect((await companyBoostUntil(db(), m!.company.id))?.getTime()).toBe(second.getTime());
  });

  it('pays +25 % of the freight on a member\'s run', async () => {
    const p = await playerWithCompany();
    await give(p.userId, 2_000);
    await buyCompanyBoost(db(), p.userId, new Date());
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
    const d = await acceptContract(db(), p.userId, (await makeContract('Sofia', 'Plovdiv')).id, truck!.id);
    await speedUpDelivery(db(), p.userId, d.id, 'finish', new Date());
    const rows = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, acc!.id), like(ledgerEntries.idempotencyKey, `delivery:${d.id}:%`)));
    const by = Object.fromEntries(rows.map((r) => [r.category, r.amountCents]));
    expect(by.booster).toBe(Math.round(by.freight! * COMPANY_BOOST.share));
  });
});

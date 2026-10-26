import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS } from '@/lib/game/company';
import { FEATURES } from '@/lib/game/features';
import { closeDb } from '@/server/db/client';
import { organizations } from '@/server/db/schema';
import { joinCompany, membershipOf, requirePermission, transferOwnership } from '@/server/game/membership';
import { db, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

describe('v1.1.2 fixes', () => {
  it('cabotage is no longer a feature', () => {
    expect('cabotage' in FEATURES).toBe(false);
  });

  it('the heir of a company holds every right, the old owner no more than a deputy', async () => {
    const owner = await playerWithCompany();
    const [org] = await db().select().from(organizations).where(eq(organizations.ownerId, owner.userId));
    await db().update(organizations).set({ recruitment: 'open', minJoinLevel: 1 }).where(eq(organizations.id, org!.id));
    const heir = await newPlayer();
    await joinCompany(db(), heir.userId, org!.id);
    await transferOwnership(db(), owner.userId, heir.userId, false);

    const m = await membershipOf(db(), heir.userId);
    expect(m!.rank.isOwner).toBe(true);
    for (const p of ALL_PERMISSIONS) await db().transaction((tx) => requirePermission(tx, heir.userId, p));
    const old = await membershipOf(db(), owner.userId);
    expect(old!.rank.isOwner).toBe(false);
  });
});

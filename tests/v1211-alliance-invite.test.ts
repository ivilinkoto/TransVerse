import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/server/db/client';
import { organizations, users } from '@/server/db/schema';
import { createAlliance, inviteToAlliance } from '@/server/game/alliances';
import { GameError } from '@/server/game/errors';
import { db, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));

describe('1.2.1.1 alliance invites before the release', () => {
  it('the team cannot invite a players’ company that has no alliances yet (they would get a 404)', async () => {
    const staff = await playerWithCompany('Sofia');
    const player = await playerWithCompany('Plovdiv');
    // Alliances come with 1.5 (2027): the team has them early, players do not.
    await db().update(users).set({ role: 'admin' }).where(eq(users.id, staff.userId));
    await createAlliance(db(), staff.userId, `Тест ${Date.now() % 1_000_000}`, new Date('2026-11-04T10:00:00Z'));
    const [org] = await db().select().from(organizations).where(eq(organizations.ownerId, player.userId));
    expect(await code(inviteToAlliance(db(), staff.userId, org!.name, new Date('2026-11-04T10:00:00Z')))).toBe('not_released_for_them');
  });
});

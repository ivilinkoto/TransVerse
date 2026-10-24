import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { SECTIONS, tabGroups, unlockTabs, visibleTabs } from '@/components/game/nav';
import { UNLOCK_INFO } from '@/lib/game/unlocks';
import { closeDb } from '@/server/db/client';
import { companies, users } from '@/server/db/schema';
import { nextSteps } from '@/server/game/next-steps';
import { pendingUnlocks, setUiPrefs } from '@/server/game/ui-prefs';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const compete = SECTIONS.find((s) => s.key === 'compete')!;

describe('v1.9 a clearer game', () => {
  it('long sections come in groups; the menu grows with the level; the open page always shows', () => {
    const all = visibleTabs(compete, null, '/game/missions');
    const groups = tabGroups(all).map((g) => g.name);
    expect(groups).toEqual(expect.arrayContaining(['Днес', 'Класации', 'Колекции', 'Общност']));
    const newcomer = visibleTabs(compete, null, '/game/missions', () => true, { level: 1, showAll: false }).map((t) => t.href);
    expect(newcomer).toContain('/game/missions');
    expect(newcomer).not.toContain('/game/cup');
    expect(visibleTabs(compete, null, '/game/cup', () => true, { level: 1, showAll: false }).map((t) => t.href)).toContain('/game/cup');
    expect(visibleTabs(compete, null, '/game/missions', () => true, { level: 1, showAll: true }).length).toBe(all.length);
    // Every page that unlocks has its short how-to.
    for (const t of unlockTabs()) expect(UNLOCK_INFO[t.href], t.href).toBeTruthy();
  });

  it('a long-time player is not flooded with unlock windows; a level-up shows the new page', async () => {
    const p = await newPlayer();
    await db().update(users).set({ level: 4 }).where(eq(users.id, p.userId));
    const open = unlockTabs().map((t) => ({ href: t.href, minLevel: t.minLevel! }));
    const read = async () => (await db().select().from(users).where(eq(users.id, p.userId)))[0]!;
    expect(await pendingUnlocks(db(), await read(), open)).toEqual([]);
    await db().update(users).set({ level: 5 }).where(eq(users.id, p.userId));
    const fresh = await pendingUnlocks(db(), await read(), open);
    expect(fresh).toContain('/game/trade');
    expect(fresh).not.toContain('/game/clients');
    await setUiPrefs(db(), p.userId, { seenUnlocks: fresh });
    expect(await pendingUnlocks(db(), await read(), open)).toEqual([]);
  });

  it('what to do now: an idle truck and the daily reward', async () => {
    const p = await newPlayer();
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const u = (await db().select().from(users).where(eq(users.id, p.userId)))[0]!;
    const steps = await nextSteps(db(), u, acc!.id, new Date());
    expect(steps.some((s) => s.emoji === '🚛')).toBe(true);
    expect(steps.length).toBeLessThanOrEqual(3);
  });
});

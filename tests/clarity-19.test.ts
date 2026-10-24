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

describe('v1.9 clearer words and messages', () => {
  it('arrivals of one day fold into one line with the net sum; other messages stay', async () => {
    const { digest } = await import('@/lib/game/digest');
    const at = new Date('2027-06-20T10:00:00Z');
    const list = [
      { title: 'Доставено: Мебели в Пловдив', body: 'Нетен резултат 1 200 лв., +80 опит.', createdAt: at },
      { title: 'Доставено: Плодове във Варна', body: 'Нетен резултат -150 лв., +40 опит.', createdAt: at },
      { title: 'Ниво 5!', body: '…', createdAt: at },
      { title: 'Доставено: Цимент в Русе', body: 'Нетен резултат 300 лв.', createdAt: at },
    ];
    const d = digest(list);
    expect(d.map((g) => [g.kind, g.count, g.netLv])).toEqual([['group', 2, 1050], ['one', 1, 0], ['one', 1, 300]]);
  });

  it('each reason a vehicle cannot take a load says what fixes it', async () => {
    const { fixFor } = await import('@/components/game/WhyNot');
    expect(fixFor('Нужна е надстройка: платформа.')?.href).toBe('/game/market');
    expect(fixFor('Влекачът няма прикачено ремарке.')?.href).toBe('/game/garage');
    expect(fixFor('Изисква ниво 4.')?.href).toBe('/game/progress');
  });
});

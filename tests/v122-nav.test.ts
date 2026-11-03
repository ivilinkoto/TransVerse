import { describe, expect, it } from 'vitest';
import { SECTIONS, SECTIONS_V2, coreTabs, mainKeys, navSections, sectionFor, visibleTabs } from '@/components/game/nav';
import { FEATURES } from '@/lib/game/features';
import { releaseByVersion } from '@/lib/game/releases';

const all = () => true;
const v2 = (f: string) => f !== 'none';
const old = (f: string) => f !== 'nav_v2';
const hrefs = (list: typeof SECTIONS) => list.flatMap((s) => (s.tabs?.length ? s.tabs.map((t) => t.href) : [s.href]));

describe('1.2.2 the simpler menu', () => {
  it('is gated by nav_v2 under 1.2.2, with release notes', () => {
    expect(FEATURES.nav_v2).toBe('1.2.2');
    expect(releaseByVersion('1.2.2')?.name).toBe('Лесен път');
    expect(navSections(old)).toBe(SECTIONS);
    expect(navSections(v2)).toBe(SECTIONS_V2);
  });

  it('keeps every page of the old menu reachable (and adds only the start pages of Състезание and Награди)', () => {
    const v2Pages = new Set(hrefs(SECTIONS_V2));
    for (const h of hrefs(SECTIONS)) expect(v2Pages.has(h), h).toBe(true);
    expect([...v2Pages].filter((h) => !hrefs(SECTIONS).includes(h)).sort()).toEqual(['/game/compete', '/game/rewards']);
    expect(sectionFor('/game/compete', v2)?.key).toBe('compete');
  });

  it('has five places: Начало, Курсове, Награди, Автопарк and „Още“', () => {
    expect(mainKeys(v2)).toEqual(['home', 'jobs', 'fleet']);
    expect(SECTIONS_V2.map((s) => s.key)).not.toContain('map');
    expect(SECTIONS_V2.find((s) => s.key === 'jobs')!.label).toBe('Курсове');
    expect(SECTIONS_V2.find((s) => s.key === 'inventory')!.label).toBe('Награди');
  });

  it('puts the map under Курсове and missions, the pass and events under Награди', () => {
    expect(sectionFor('/game/map', v2)?.key).toBe('jobs');
    expect(sectionFor('/game/missions', v2)?.key).toBe('inventory');
    expect(sectionFor('/game/events', v2)?.key).toBe('inventory');
    expect(sectionFor('/game/leaderboards', v2)?.key).toBe('compete');
    expect(sectionFor('/game/map', old)?.key).toBe('map');
    expect(sectionFor('/game/missions', old)?.key).toBe('compete');
  });

  it('Автопарк shows three pages in its row', () => {
    const fleet = SECTIONS_V2.find((s) => s.key === 'fleet')!;
    expect(coreTabs(visibleTabs(fleet, null, '/game/fleet', all), '/game/fleet').map((t) => t.href)).toEqual(['/game/fleet', '/game/staff', '/game/market']);
  });
});

import { afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb } from '@/server/db/client';
import { companies, vehicles } from '@/server/db/schema';
import { nowList } from '@/server/game/now';
import { db, newPlayer } from './helpers';

describe('1.2.2 Начало „Сега“', () => {
  afterAll(() => closeDb());
  it('lists the free truck first and a worn one as a repair, one button each', async () => {
    const p = await newPlayer();
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [u] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
    const user = { id: p.userId, loginStreak: 0, dailyClaimKey: null, uiPrefs: {} };
    const list = await nowList(db(), user, acc!.id, new Date(), {});
    expect(list[0]?.tone).toBe('hot');
    expect(list.every((i) => i.href.startsWith('/game'))).toBe(true);
    await db().update(vehicles).set({ condition: 30 }).where(eq(vehicles.id, u!.id));
    const worn = await nowList(db(), user, acc!.id, new Date(), {});
    expect(worn.find((i) => i.tone === 'warn')?.href).toBe(`/game/garage#v-${u!.id}`);
    expect(worn.length).toBeLessThanOrEqual(6);
  });
});

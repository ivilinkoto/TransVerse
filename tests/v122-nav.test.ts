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

  it('keeps every page of the old menu reachable', () => {
    expect(new Set(hrefs(SECTIONS_V2))).toEqual(new Set(hrefs(SECTIONS)));
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

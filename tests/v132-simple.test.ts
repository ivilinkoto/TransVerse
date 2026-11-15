import { describe, expect, it } from 'vitest';
import { ACCOUNT_MENU_V3, PLAY_GROUP_NAMES, SECTIONS, SECTIONS_V3, coreTabs, mainKeys, navSections, sectionFor, visibleTabs } from '@/components/game/nav';
import { FEATURES } from '@/lib/game/features';
import { releaseByVersion } from '@/lib/game/releases';
import { windowsLive } from '@/server/game/tutorial-flags';

const all = () => true;
const pages = (list: typeof SECTIONS) => new Set(list.flatMap((s) => [s.href, ...(s.tabs ?? []).map((t) => t.href)]));

describe('1.3.2 „Просто“', () => {
  it('is gated by simple_menu under 1.3.2, with release notes', () => {
    expect(FEATURES.simple_menu).toBe('1.3.2');
    const r = releaseByVersion('1.3.2')!;
    expect(r.name).toBe('Просто');
    expect(new Date(r.publishedAt) > new Date(releaseByVersion('1.3')!.publishedAt)).toBe(true);
    expect(navSections(all)).toBe(SECTIONS_V3);
  });

  it('has five places, all in the main menu, and no „Още“', () => {
    expect(SECTIONS_V3.map((s) => s.label)).toEqual(['Начало', 'Курсове', 'Автопарк', 'Компания', 'Игри и награди']);
    expect(mainKeys(all)).toEqual(SECTIONS_V3.map((s) => s.key));
  });

  it('keeps every page of the old menu reachable (only the old pass page, replaced by the season, goes)', () => {
    const v3 = pages(SECTIONS_V3);
    expect([...pages(SECTIONS)].filter((h) => !v3.has(h))).toEqual(['/game/pass']);
  });

  it('lists every page once (no inventory or season twice)', () => {
    const hrefs = SECTIONS_V3.flatMap((s) => (s.tabs ?? []).map((t) => t.href));
    expect(hrefs.length).toBe(new Set(hrefs).size);
  });

  it('puts the map under Курсове, the bag and missions under „Игри и награди“', () => {
    expect(sectionFor('/game/map', all)?.key).toBe('jobs');
    expect(sectionFor('/game/inventory/workshop', all)?.key).toBe('compete');
    expect(sectionFor('/game/missions', all)?.key).toBe('compete');
    expect(sectionFor('/game/courier', all)?.key).toBe('compete');
    expect(sectionFor('/game/play', all)?.key).toBe('compete');
    expect(sectionFor('/game/staff', all)?.key).toBe('fleet');
  });

  it('keeps the rows short: at most four or five pages before „Още ▾“', () => {
    for (const s of SECTIONS_V3) {
      const row = coreTabs(visibleTabs(s, null, s.href, all), s.href);
      expect(row.length).toBeLessThanOrEqual(5);
    }
  });

  it('groups „Игри и награди“ and shows holidays only while they run', () => {
    const play = SECTIONS_V3.find((s) => s.key === 'compete')!;
    const groups = new Set((play.tabs ?? []).filter((t) => t.group).map((t) => t.group));
    expect([...groups].every((g) => PLAY_GROUP_NAMES.includes(g!))).toBe(true);
    expect(visibleTabs(play, null, '/game/play', all).some((t) => t.holiday)).toBe(false);
    expect(visibleTabs(play, 'christmas', '/game/play', all).some((t) => t.holiday === 'christmas')).toBe(true);
  });

  it('opens sections as pages, not windows, and keeps a shorter avatar menu', async () => {
    expect(await windowsLive(null as never, '', { game_ui: true, simple_menu: true })).toBe(false);
    expect(await windowsLive(null as never, '', { game_ui: true, simple_menu: false })).toBe(true);
    expect(ACCOUNT_MENU_V3.map((i) => i.href)).not.toContain('/game/mentor');
    expect(ACCOUNT_MENU_V3.map((i) => i.href)).toContain('/game/support');
  });
});

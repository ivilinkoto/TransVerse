import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { activeTab, familyFor, PAGE_FAMILIES, SECTIONS_V3 } from '@/components/game/nav';
import { FEATURES, RETIRED_PAGES } from '@/lib/game/features';
import { releaseByVersion } from '@/lib/game/releases';
import { closeDb } from '@/server/db/client';
import { companies, jobState } from '@/server/db/schema';
import { settleRetired2, workshopRefundCents } from '@/server/game/retired-2';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const v3Pages = () => SECTIONS_V3.flatMap((s) => (s.tabs ?? []).map((t) => t.href));

describe('1.3.2 „Просто“: fewer places', () => {
  it('drops the removed pages and sends their old links to the game', () => {
    for (const page of ['/game/workshops', '/game/dock', '/game/news']) {
      expect(v3Pages()).not.toContain(page);
      expect(RETIRED_PAGES).toContain(page);
    }
    expect(Object.keys(FEATURES)).not.toContain('player_workshops');
    expect(Object.keys(FEATURES)).not.toContain('dock_slots');
    expect(releaseByVersion('1.3.2')!.sections.some((s) => s.title === 'Махнато')).toBe(true);
  });

  it('keeps related pages together: the menu has the first, the others are its tabs', () => {
    expect(familyFor('/game/league')!.family[0]!.href).toBe('/game/leaderboards');
    expect(familyFor('/game/inventory/album')!.page.href).toBe('/game/inventory/album');
    expect(familyFor('/game/inventory')!.page.href).toBe('/game/inventory');
    expect(familyFor('/game/company/chat')!.family[0]!.href).toBe('/game/company');
    expect(familyFor('/game/analytics')!.family[0]!.href).toBe('/game/finance');
    expect(familyFor('/game/contracts')).toBeUndefined();
    // Only the first page of a family is in the menu…
    for (const family of PAGE_FAMILIES) for (const page of family.slice(1)) expect(v3Pages()).not.toContain(page.href);
    // …and a page of the family lights up its tab.
    const play = SECTIONS_V3.find((s) => s.key === 'compete')!;
    expect(activeTab(play, '/game/league')?.href).toBe('/game/leaderboards');
    const company = SECTIONS_V3.find((s) => s.key === 'company')!;
    expect(activeTab(company, '/game/reviews')?.href).toBe('/game/company');
    // Клиенти and Конвои wait behind „Още“.
    const jobs = SECTIONS_V3.find((s) => s.key === 'jobs')!;
    expect(jobs.tabs!.filter((t) => t.core).map((t) => t.href)).toEqual(['/game/contracts', '/game/map']);
  });

  it('gives a workshop owner back what it cost, once', async () => {
    expect(workshopRefundCents(1)).toBe(50_000_00);
    expect(workshopRefundCents(3)).toBe(140_000_00);
    const p = await newPlayer();
    const [before] = await db().select({ balance: companies.balanceCents }).from(companies).where(eq(companies.ownerId, p.userId));
    await db().insert(jobState).values({ key: `workshop:${p.userId}`, value: { ownerId: p.userId, name: 'Тест', level: 2 } });
    await db().delete(jobState).where(eq(jobState.key, 'retired-2026-11-27'));
    expect((await settleRetired2(db()))!.workshops).toBeGreaterThanOrEqual(1);
    expect(await settleRetired2(db())).toBeNull();
    const [after] = await db().select({ balance: companies.balanceCents }).from(companies).where(eq(companies.ownerId, p.userId));
    expect(Number(after!.balance) - Number(before!.balance)).toBe(80_000_00);
    expect(await db().select().from(jobState).where(eq(jobState.key, `workshop:${p.userId}`))).toHaveLength(0);
  });
});

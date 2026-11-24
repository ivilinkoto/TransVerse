import { describe, expect, it } from 'vitest';
import { familyFor, PAGE_FAMILIES, sectionFor, SECTIONS_V3 } from '@/components/game/nav';

const all = () => true;
const row = (key: string) => SECTIONS_V3.find((s) => s.key === key)!.tabs!.map((t) => t.href);

describe('1.3.3 „Всичко на едно място“', () => {
  it('Автопарк: trucks, trailers, trains, drivers and the market; no Service, log or cab', () => {
    expect(row('fleet').slice(0, 5)).toEqual(['/game/fleet', '/game/fleet/trailers', '/game/trains', '/game/staff', '/game/market']);
    for (const gone of ['/game/garage', '/game/trips', '/game/cabin', '/game/skills', '/game/mascot']) expect(row('fleet')).not.toContain(gone);
  });

  it('pages that belong together are tabs of one place', () => {
    expect(familyFor('/game/skills')?.family[0]?.href).toBe('/game/staff');
    expect(familyFor('/game/mascot')?.family[0]?.href).toBe('/game/staff');
    expect(familyFor('/game/reviews')?.family[0]?.href).toBe('/game/clients');
    expect(familyFor('/game/trade')?.family[0]?.href).toBe('/game/auctions');
    for (const p of ['/game/settings', '/game/invite', '/game/help', '/game/support', '/game/updates']) expect(familyFor(p)?.family[0]?.href).toBe('/game/profile');
    expect(sectionFor('/game/skills', all)?.key).toBe('fleet');
    expect(sectionFor('/game/reviews', all)?.key).toBe('jobs');
    // Each page is in one family only.
    const hrefs = PAGE_FAMILIES.flat().map((p) => p.href);
    expect(hrefs.length).toBe(new Set(hrefs).size);
  });
});

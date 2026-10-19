import { describe, expect, it } from 'vitest';
import { planRoadEvents, seededRandom } from '@/lib/game/road-events';
import { isWinter, roadCondition, routeCondition, WINTER_SEVERITY } from '@/lib/game/winter';
import type { Segment } from '@/lib/game/schedule';

const at = (iso: string) => new Date(iso);
const schedule: Segment[] = [{ kind: 'drive', leg: 'loaded', start: 0, end: 3_600_000, fromKm: 0, toKm: 300 } as Segment];

describe('winter', () => {
  it('runs from 1 December to 15 March (Sofia), over the new year', () => {
    expect(isWinter(at('2026-11-30T12:00:00Z'))).toBe(false);
    expect(isWinter(at('2026-12-01T00:30:00+02:00'))).toBe(true);
    expect(isWinter(at('2027-01-20T12:00:00Z'))).toBe(true);
    expect(isWinter(at('2027-03-15T20:00:00Z'))).toBe(true);
    expect(isWinter(at('2027-03-16T12:00:00Z'))).toBe(false);
    expect(roadCondition('AT', at('2026-07-01T12:00:00Z'))).toBe('clear');
  });

  it('gives every country one condition per day, harsher in the mountains', () => {
    const day = at('2027-01-15T08:00:00Z');
    expect(roadCondition('AT', day)).toBe(roadCondition('AT', at('2027-01-15T20:00:00Z')));
    const share = (code: string) => {
      let bad = 0;
      for (let d = 0; d < 90; d++) if (roadCondition(code, new Date(Date.UTC(2026, 11, 1) + d * 86_400_000)) !== 'clear') bad++;
      return bad / 90;
    };
    expect(WINTER_SEVERITY.AT).toBeGreaterThan(WINTER_SEVERITY.GR!);
    expect(share('AT')).toBeGreaterThan(share('GR'));
    expect(share('AT')).toBeLessThan(0.8);
    const worst = routeCondition(['GR', 'BG', 'RS', 'HU', 'AT'], day);
    expect(['clear', 'snow', 'ice', 'blizzard']).toContain(worst.condition);
    expect(worst.condition === 'clear' ? worst.country === null : !!worst.country).toBe(true);
  });

  it('a blizzard closes the pass; winter tyres halve the chance and the delay', () => {
    const run = (tyres: boolean, seed: string) => planRoadEvents(schedule, { totalKm: 300, borders: 0, rented: false, random: seededRandom(seed), chance: 0, winter: { condition: 'blizzard', tyres } });
    let without = 0;
    let withTyres = 0;
    let delayWithout = 0;
    let delayWith = 0;
    for (let i = 0; i < 400; i++) {
      const a = run(false, `s${i}`).filter((e) => e.kind === 'pass_closed');
      const b = run(true, `s${i}`).filter((e) => e.kind === 'pass_closed');
      without += a.length;
      withTyres += b.length;
      delayWithout += a.reduce((s, e) => s + e.delayMs, 0);
      delayWith += b.reduce((s, e) => s + e.delayMs, 0);
    }
    expect(without / 400).toBeGreaterThan(0.8);
    expect(withTyres / 400).toBeLessThan(0.6);
    expect(delayWith / Math.max(1, withTyres)).toBeLessThan((delayWithout / without) * 0.6);
  });

  it('ice may cost a tow, never for a rented truck; clear roads add nothing', () => {
    const ice = planRoadEvents(schedule, { totalKm: 300, borders: 0, rented: false, random: () => 0.1, chance: 0, winter: { condition: 'ice', tyres: false } });
    expect(ice.find((e) => e.kind === 'ice')?.costCents).toBeGreaterThan(0);
    const rented = planRoadEvents(schedule, { totalKm: 300, borders: 0, rented: true, random: () => 0.1, chance: 0, winter: { condition: 'ice', tyres: true } });
    expect(rented.every((e) => e.costCents === 0)).toBe(true);
    expect(planRoadEvents(schedule, { totalKm: 300, borders: 0, rented: false, random: () => 0.1, chance: 0, winter: { condition: 'clear', tyres: false } })).toEqual([]);
  });
});

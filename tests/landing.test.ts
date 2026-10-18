import { describe, expect, it } from 'vitest';
import { liveWorld, nextAuctionHour } from '@/server/showcase';

describe('public page data', () => {
  it('names the next special-load auction by Sofia time', () => {
    // 2026-10-19 is summer time in Sofia (UTC+3).
    expect(nextAuctionHour(new Date('2026-10-19T05:00:00Z'))).toEqual({ hour: 10, tomorrow: false });
    expect(nextAuctionHour(new Date('2026-10-19T11:30:00Z'))).toEqual({ hour: 18, tomorrow: false });
    expect(nextAuctionHour(new Date('2026-10-19T19:00:00Z'))).toEqual({ hour: 10, tomorrow: true });
  });

  it('reads the live world without player names', async () => {
    const world = await liveWorld(new Date());
    expect(world.online).toBeGreaterThanOrEqual(0);
    expect(world.recent.length).toBeLessThanOrEqual(6);
    for (const d of world.recent) expect(Object.keys(d)).not.toContain('username');
  });
});

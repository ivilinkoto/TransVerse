import { describe, expect, it } from 'vitest';
import { DRIVING_RULES, buildSchedule, estimateMinutes, scheduleEnd, stateAt } from '@/lib/game/schedule';

const MIN = 60_000;

describe('delivery schedule', () => {
  it('terminates for awkward floating-point distances (regression)', () => {
    for (let i = 0; i < 2000; i++) {
      const kmValue = 1 + i * 1.37;
      const minutes = estimateMinutes({ empty: { km: kmValue / 3, durationS: (kmValue / 3 / 71.3) * 3600, borderKms: [] }, loaded: { km: kmValue, durationS: (kmValue / 67.9) * 3600, borderKms: [kmValue / 2] }, speedFactor: 1.15 });
      expect(Number.isFinite(minutes)).toBe(true);
    }
  });

  it('inserts a 45 min break after 4.5 h and an 11 h rest after 9 h of driving', () => {
    const s = buildSchedule({ startAt: 0, empty: null, loaded: { km: 1000, durationS: 12.5 * 3600, borderKms: [] }, speedFactor: 1, timeScale: 1 });
    const breaks = s.filter((x) => x.kind === 'break');
    const rests = s.filter((x) => x.kind === 'rest');
    expect(breaks.length).toBeGreaterThanOrEqual(1);
    expect(rests).toHaveLength(1);
    expect((rests[0]!.end - rests[0]!.start) / MIN).toBe(DRIVING_RULES.dailyRestMin);
    let continuous = 0;
    for (const seg of s) {
      if (seg.kind === 'drive') continuous += (seg.end - seg.start) / MIN;
      else if (seg.kind !== 'border') continuous = 0;
      expect(continuous).toBeLessThanOrEqual(DRIVING_RULES.breakAfterMin + 1e-6);
    }
  });

  it('waits at the border at its real position and interpolates progress', () => {
    const s = buildSchedule({ startAt: 0, empty: null, loaded: { km: 300, durationS: 4 * 3600, borderKms: [120] }, speedFactor: 1, timeScale: 1 });
    const border = s.find((x) => x.kind === 'border')!;
    expect(border.fromKm).toBeCloseTo(120);
    expect(stateAt(s, (border.start + border.end) / 2).km).toBeCloseTo(120);
    expect(stateAt(s, scheduleEnd(s) + 1).done).toBe(true);
    expect(stateAt(s, 0).progress).toBe(0);
  });
});

describe('game time', () => {
  it('compresses trips to hours, growing with distance', async () => {
    const { gameDurationMinutes, buildGameSchedule, scheduleEnd: end, contractWindowMinutes } = await import('@/lib/game/schedule');
    expect(gameDurationMinutes(20)).toBe(15);
    expect(gameDurationMinutes(150)).toBe(30);
    expect(gameDurationMinutes(500)).toBe(60);
    expect(gameDurationMinutes(1200)).toBe(125);
    expect(gameDurationMinutes(3000)).toBe(285); // long hauls keep growing — no cap
    expect(gameDurationMinutes(4000)).toBeGreaterThan(gameDurationMinutes(3000));
    const s = buildGameSchedule({ startAt: 1000, empty: { km: 100, durationS: 5000, borderKms: [] }, loaded: { km: 1100, durationS: 14 * 3600, borderKms: [500] }, speedFactor: 1 });
    expect((end(s) - 1000) / MIN).toBeCloseTo(gameDurationMinutes(1200), 5);
    expect(s.some((x) => x.kind === 'rest')).toBe(true);
    expect(s.some((x) => x.kind === 'border')).toBe(true);
    expect(contractWindowMinutes(300)).toBeGreaterThan(gameDurationMinutes(300));
  });
});

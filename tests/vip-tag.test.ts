import { describe, expect, it } from 'vitest';
import { hasVipTag, vipLabel, vipTag } from '@/lib/game/vip';

describe('1.3.3: the VIP level next to a name', () => {
  const now = new Date('2026-12-01T12:00:00Z');
  const later = new Date('2026-12-10T12:00:00Z');
  it('shows the level (VIP1–VIP5), plain VIP for VIP time without a level, nothing without VIP', () => {
    expect(vipTag(null, 3, now)).toBe(3);
    expect(vipTag(later, 5, now)).toBe(5);
    expect(vipTag(later, 0, now)).toBe(0);
    expect(vipTag(null, 0, now)).toBeNull();
    expect(vipTag(new Date('2026-11-01T00:00:00Z'), 0, now)).toBeNull();
    expect(vipLabel(3)).toBe('VIP3');
    expect(vipLabel(0)).toBe('VIP');
    expect(hasVipTag(0)).toBe(true);
    expect(hasVipTag(null)).toBe(false);
  });
});

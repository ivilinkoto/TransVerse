import { describe, expect, it } from 'vitest';
import { longLabels } from '../scripts/i18n/long-labels';

/**
 * 1.1.4.2: short labels (buttons, tabs, chips) whose English or Russian is much
 * longer than the Bulgarian break the buttons on a phone. Most of today's list
 * are place names (the official GeoNames name); the count may only go down.
 */
const ALLOWED = 55;

describe('translations of short labels', () => {
  it('do not get much longer than the Bulgarian (no new ones)', () => {
    const list = longLabels();
    expect(list.length, list.map((l) => `${l.locale} ${l.key} → ${l.text}`).join('\n')).toBeLessThanOrEqual(ALLOWED);
  });
});

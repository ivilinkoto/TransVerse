import { describe, expect, it } from 'vitest';
import { longTexts } from '../scripts/ui/long-texts';

/**
 * 1.1.4.1: the game should read quickly. The long texts on game screens may only
 * get fewer — a new one over the limit means: shorten it, or put the details
 * behind „ⓘ“ / „Научи повече“.
 */
const ALLOWED = 119;

describe('short texts', () => {
  it(`no more than ${ALLOWED} texts over the limit on game screens`, () => {
    const found = longTexts();
    expect(found.length, found.slice(0, 10).map((t) => `${t.file}:${t.line}`).join('\n')).toBeLessThanOrEqual(ALLOWED);
  });
});

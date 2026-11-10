import { describe, expect, it } from 'vitest';
import { windowsLive } from '@/server/game/tutorial-flags';

/**
 * 1.3 „Нов облик“: sections open as windows for every player once the new look is on —
 * not only after the tutorial (a player mid-tutorial used to get full page loads everywhere,
 * which is what a phone test showed before the release).
 */
describe('1.3 game windows', () => {
  it('are on whenever the new look is on, whatever the tutorial state', async () => {
    // The tutorial is no longer read, so no database is needed.
    const db = {} as never;
    expect(await windowsLive(db, 'any-player', { game_ui: true })).toBe(true);
  });

  it('are off without the new look', async () => {
    const db = {} as never;
    expect(await windowsLive(db, 'any-player', { game_ui: false })).toBe(false);
    expect(await windowsLive(db, 'any-player', {})).toBe(false);
  });
});

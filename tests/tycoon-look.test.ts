import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { iconForEmoji } from '@/components/gameui/Icon3D';
import { featureLive } from '@/lib/game/features';
import { tycoonLook } from '@/lib/game/look';
import { SHOP_EMOJI } from '@/lib/game/shop-look';
import { closeDb } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { runAction } from '@/server/game/actions';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

describe('1.4 „Нов облик“: the Тайкун look', () => {
  it('is staff-only until 1.4 and then the default, unless the player picks the classic look', () => {
    expect(featureLive('tycoon_look', new Date('2026-12-01T12:00:00+02:00'))).toBe(false);
    expect(featureLive('tycoon_look', new Date('2026-12-01T12:00:00+02:00'), true)).toBe(true);
    expect(featureLive('tycoon_look', new Date('2026-12-13T12:00:00+02:00'))).toBe(true);
    expect(tycoonLook(true, undefined)).toBe(true);
    expect(tycoonLook(true, 'tycoon')).toBe(true);
    expect(tycoonLook(true, 'classic')).toBe(false);
    expect(tycoonLook(false, 'tycoon')).toBe(false);
  });

  it('the player picks the look in Settings', async () => {
    const p = await newPlayer();
    const run = (style: 'classic' | 'tycoon') => runAction(db(), { id: p.userId, role: 'player', username: p.username }, { type: 'uiPrefs', style }, async () => '127.0.0.1');
    await run('classic');
    expect((await db().select({ prefs: users.uiPrefs }).from(users).where(eq(users.id, p.userId)))[0]!.prefs.style).toBe('classic');
    await run('tycoon');
    expect((await db().select({ prefs: users.uiPrefs }).from(users).where(eq(users.id, p.userId)))[0]!.prefs.style).toBe('tycoon');
  });

  it('every shop product, dashboard shortcut and "waits for you" emoji has a 3D icon', () => {
    for (const e of Object.values(SHOP_EMOJI)) expect(iconForEmoji(e!), e).toBeDefined();
    const sources = ['src/app/game/page.tsx', 'src/server/game/now.ts', 'src/server/game/next-steps.ts', 'src/components/shop/ShopStore.tsx'];
    for (const f of sources) {
      for (const [, e] of readFileSync(f, 'utf8').matchAll(/(?:emoji|icon): '([^']+)'/g)) expect(iconForEmoji(e!), `${f}: ${e}`).toBeDefined();
    }
    // The variation selector does not matter.
    expect(iconForEmoji('🗺️')).toEqual(iconForEmoji('🗺'));
  });

  it('ships its fonts with their licences', () => {
    for (const f of ['Unbounded', 'Rubik']) {
      for (const sub of ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext']) expect(readFileSync(`public/fonts/tycoon/${f}-${sub}.woff2`).length).toBeGreaterThan(1000);
      expect(readFileSync(`public/fonts/tycoon/${f}-OFL.txt`, 'utf8')).toContain('SIL Open Font License');
    }
  });
});

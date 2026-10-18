import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { compareVersions, currentVersion, RELEASES, unseenRelease, visibleReleases } from '@/lib/game/releases';
import { closeDb } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { markReleaseSeen } from '@/server/game/releases';
import { db, newPlayer } from './helpers';

afterAll(async () => closeDb());

describe('releases', () => {
  it('compares versions and shows a release from its publication time (staff earlier)', () => {
    expect(compareVersions('1.10', '1.9')).toBe(1);
    expect(compareVersions('1.1', '1.1.0')).toBe(0);
    expect(compareVersions('1.0', '1.1')).toBe(-1);
    const latest = RELEASES[0]!;
    const before = new Date(new Date(latest.publishedAt).getTime() - 60_000);
    const after = new Date(new Date(latest.publishedAt).getTime() + 60_000);
    expect(visibleReleases(before).some((r) => r.version === latest.version)).toBe(false);
    expect(visibleReleases(before, true)[0]!.version).toBe(latest.version);
    expect(currentVersion(after)).toBe(latest.version);
    expect(unseenRelease(null, after)!.version).toBe(latest.version);
    expect(unseenRelease('1.0', after)!.version).toBe(latest.version);
    expect(unseenRelease(latest.version, after)).toBeNull();
  });

  it('new players start on the current version; the window is closed once and never goes back', async () => {
    const p = await newPlayer();
    const [u] = await db().select({ seen: users.seenVersion }).from(users).where(eq(users.id, p.userId));
    expect(u!.seen).toBe(currentVersion(new Date()));
    await db().update(users).set({ seenVersion: null }).where(eq(users.id, p.userId));
    await markReleaseSeen(db(), p.userId, RELEASES[0]!.version);
    await expect(markReleaseSeen(db(), p.userId, '9.9')).rejects.toBeInstanceOf(GameError);
    const [after] = await db().select({ seen: users.seenVersion }).from(users).where(eq(users.id, p.userId));
    expect(after!.seen).toBe(RELEASES[0]!.version);
  });
});

import { afterAll, describe, expect, it } from 'vitest';
import { like } from 'drizzle-orm';
import { closeDb, getDb } from '@/server/db/client';
import { jobState } from '@/server/db/schema';
import { flushVisits, noteVisit, pageOf, pageUsage } from '@/server/page-visits';
import { featureUsage } from '@/server/admin-usage';
import { newPlayer } from './helpers';

const db = () => getDb();

afterAll(async () => {
  await db().delete(jobState).where(like(jobState.key, 'page-visits:%'));
  await closeDb();
});

describe('Админ → Използване', () => {
  it('counts a page by its menu entry', () => {
    expect(pageOf('/game')).toBe('/game');
    expect(pageOf('/game/fleet/abc')).toBe('/game/fleet');
    expect(pageOf('/game/inventory/album?x=1')).toBe('/game/inventory/album');
    expect(pageOf('/game/no-such-page')).toBeNull();
    expect(pageOf('/admin')).toBeNull();
  });

  it('counts each player once per page and day, across flushes', async () => {
    await db().delete(jobState).where(like(jobState.key, 'page-visits:%'));
    const now = new Date();
    noteVisit('u1', '/game/fleet', now);
    noteVisit('u1', '/game/fleet/x', now);
    noteVisit('u2', '/game/fleet', now);
    await flushVisits(db());
    noteVisit('u1', '/game/fleet', now);
    noteVisit('u1', '/game/play', now);
    await flushVisits(db());
    const u = await pageUsage(db(), now);
    expect(u.pages.find((p) => p.page === '/game/fleet')?.players).toBe(2);
    expect(u.pages.find((p) => p.page === '/game/play')?.players).toBe(1);
    expect(u.since).not.toBeNull();
  });

  it('reads what paid players in the last 30 days', async () => {
    await newPlayer();
    const u = await featureUsage(db(), new Date());
    expect(u.days).toBe(30);
    expect(Array.isArray(u.xp) && Array.isArray(u.coins) && Array.isArray(u.money)).toBe(true);
  });
});

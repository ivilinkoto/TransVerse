import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { CAREER_ROLES, CAREERS } from '@/lib/game/careers';
import { FEATURES } from '@/lib/game/features';
import { releaseByVersion } from '@/lib/game/releases';
import { closeDb } from '@/server/db/client';
import { notifications, userBadges } from '@/server/db/schema';
import { applyForRole, listApplications, myApplication, setApplicationStatus } from '@/server/game/careers';
import { GameError } from '@/server/game/errors';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const OK = { adult: true, consent: true };
const ABOUT = 'Играя всеки ден от септември, водя Facebook страница на местен клуб и обичам да пиша.';

describe('1.3.1 „Екипът“', () => {
  it('is its own small release with open roles and no window', () => {
    expect(FEATURES.careers).toBe('1.3.1');
    expect(releaseByVersion('1.3.1')?.name).toBe('Екипът');
    expect(CAREER_ROLES.filter((r) => r.open).length).toBeGreaterThanOrEqual(5);
  });

  it('a player applies, can change it, and the admins decide; accepted gets the team badge', async () => {
    const p = await newPlayer();
    const now = new Date();
    expect(await code(applyForRole(db(), p.userId, { role: 'community', about: ABOUT, hours: 5, contact: 'me#1', consent: true }, now))).toBe('too_young');
    expect(await code(applyForRole(db(), p.userId, { role: 'community', about: ABOUT, hours: 5, contact: 'me#1', adult: true }, now))).toBe('no_consent');
    expect(await code(applyForRole(db(), p.userId, { role: 'pilot', about: ABOUT, hours: 5, contact: 'me#1', ...OK }, now))).toBe('no_role');
    expect(await code(applyForRole(db(), p.userId, { role: 'community', about: 'кратко', hours: 5, contact: 'me#1', ...OK }, now))).toBe('too_short');
    expect(await code(applyForRole(db(), p.userId, { role: 'community', about: ABOUT, hours: 5, contact: ' ', ...OK }, now))).toBe('no_contact');
    expect(await code(applyForRole(db(), p.userId, { role: 'community', about: ABOUT, hours: 5, contact: 'me#1', link: 'javascript:alert(1)', ...OK }, now))).toBe('bad_link');
    expect(await code(applyForRole(db(), p.userId, { role: 'community', about: ABOUT, hours: 5, contact: 'me#1', ...OK }, now))).toBe('ok');
    expect(await code(applyForRole(db(), p.userId, { role: 'moderator', about: ABOUT, hours: 99, contact: 'me#1', link: 'https://example.com/me', ...OK }, now))).toBe('ok');
    const mine = (await myApplication(db(), p.userId))!;
    expect(mine).toMatchObject({ role: 'moderator', status: 'new', hours: 40, link: 'https://example.com/me' });
    expect((await listApplications(db(), 'new')).some((a) => a.userId === p.userId && a.player?.username === p.username)).toBe(true);
    await setApplicationStatus(db(), p.userId, 'interview', undefined, now);
    expect(await code(applyForRole(db(), p.userId, { role: 'community', about: ABOUT, hours: 5, contact: 'me#1', ...OK }, now))).toBe('decided');
    await setApplicationStatus(db(), p.userId, 'accepted', 'добре дошъл', now);
    expect((await myApplication(db(), p.userId))!.status).toBe('accepted');
    const badges = await db().select().from(userBadges).where(eq(userBadges.userId, p.userId));
    expect(badges.map((b) => b.badge)).toContain(CAREERS.badge);
    const notes = await db().select().from(notifications).where(eq(notifications.userId, p.userId));
    expect(notes.length).toBeGreaterThanOrEqual(2);
    expect(await code(setApplicationStatus(db(), (await newPlayer()).userId, 'accepted', undefined, now))).toBe('not_found');
  });
});

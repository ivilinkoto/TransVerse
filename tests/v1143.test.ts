import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/server/db/client';
import { FEATURES } from '@/lib/game/features';
import { compareVersions, releaseByVersion } from '@/lib/game/releases';
import { motionEnabled } from '@/lib/client/motion';
import { StarsReveal } from '@/components/fx/StarsReveal';
import { DriverPortrait } from '@/components/game/DriverPortrait';
import { AnimatedAmount } from '@/components/fx/AnimatedAmount';

afterAll(() => closeDb());

describe('1.1.4.3 „Живи награди“', () => {
  it('ships between 1.1.4.2 and 1.2 with its feature', () => {
    const r = releaseByVersion('1.1.4.3')!;
    expect(r.name).toBe('Живи награди');
    expect(compareVersions('1.1.4.3', '1.1.4.2')).toBe(1);
    expect(compareVersions('1.2', '1.1.4.3')).toBe(1);
    expect(new Date(r.publishedAt).getTime()).toBeLessThan(new Date(releaseByVersion('1.2')!.publishedAt).getTime());
    expect(FEATURES.game_fx).toBe('1.1.4.3');
  });

  it('no animations on the server (no window)', () => {
    expect(motionEnabled()).toBe(false);
  });

  it('stars: five marks, only the earned ones pop and only when asked', () => {
    const still = renderToStaticMarkup(createElement(StarsReveal, { stars: 3, animate: false, label: '3' }));
    const moving = renderToStaticMarkup(createElement(StarsReveal, { stars: 3, animate: true, label: '3' }));
    expect(still.match(/★/g)).toHaveLength(5);
    expect(still).not.toContain('fx-pop');
    expect(moving.match(/fx-pop/g)).toHaveLength(3);
  });

  it('a new piece on the portrait drops in, the others stay still', () => {
    const html = renderToStaticMarkup(createElement(DriverPortrait, { id: 'd1', name: 'Иван Петров', look: { cap: true, glasses: true }, fresh: 'cap' }));
    expect(html.match(/fx-drop/g)).toHaveLength(1);
    expect(renderToStaticMarkup(createElement(DriverPortrait, { id: 'd1', name: 'Иван Петров', look: { cap: true } }))).not.toContain('fx-drop');
  });

  it('the top bar amount renders the real value first', () => {
    expect(renderToStaticMarkup(createElement(AnimatedAmount, { value: 1_234_500, kind: 'money' }))).toContain('лв.');
    expect(renderToStaticMarkup(createElement(AnimatedAmount, { value: 42, kind: 'coins' }))).toContain('42');
  });
});

describe('1.1.4.4 hire drivers without a company', () => {
  it('an independent driver hires up to 3 drivers; a company owner has no such limit', async () => {
    const { db, newPlayer, playerWithCompany } = await import('./helpers');
    const { candidates, hireDriver } = await import('@/server/game/staff');
    const { companyForUser, hireMode, SOLO_HIRE_MAX } = await import('@/server/game/company');
    const { GameError } = await import('@/server/game/errors');
    expect(FEATURES.hire_solo).toBe('1.1.4.4');
    const solo = await newPlayer();
    const account = await companyForUser(db(), solo.userId);
    expect(await hireMode(db(), solo.userId, account, new Date('2026-11-02T10:00:00+02:00'))).toBe('solo');
    expect(await hireMode(db(), solo.userId, account, new Date('2026-10-01T10:00:00+03:00'))).toBe('none');
    for (let i = 0; i < SOLO_HIRE_MAX; i++) {
      const [c] = await candidates(db(), account.id);
      await hireDriver(db(), solo.userId, c!.id);
    }
    const [next] = await candidates(db(), account.id);
    const err = await hireDriver(db(), solo.userId, next!.id).then(() => null, (e: unknown) => e);
    expect(err instanceof GameError ? err.code : err).toBe('solo_hire_limit');
    const owner = await playerWithCompany();
    const firm = await companyForUser(db(), owner.userId);
    expect(await hireMode(db(), owner.userId, firm)).toBe('company');
  });
});

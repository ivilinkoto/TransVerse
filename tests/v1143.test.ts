import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FEATURES } from '@/lib/game/features';
import { compareVersions, releaseByVersion } from '@/lib/game/releases';
import { motionEnabled } from '@/lib/client/motion';
import { StarsReveal } from '@/components/fx/StarsReveal';
import { DriverPortrait } from '@/components/game/DriverPortrait';
import { AnimatedAmount } from '@/components/fx/AnimatedAmount';

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

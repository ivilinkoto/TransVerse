'use client';

import { motionEnabled } from '@/lib/client/motion';

/**
 * 1.1.4.3: small effects made from plain DOM nodes and the Web Animations API —
 * no library, nothing stays on the page after the effect ends, and nothing
 * happens when animations are switched off.
 */
const layer = () => {
  let el = document.getElementById('tv-fx');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tv-fx';
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:90;overflow:hidden';
    document.body.appendChild(el);
  }
  return el;
};

const centerOf = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

export type Point = { x: number; y: number };
export const pointOf = (target: Element | Point): Point => ('x' in target ? target : centerOf(target));

/** Confetti or sparks from a point. */
export function burst(from: Element | Point, opts: { colors?: string[]; count?: number; spread?: number; shapes?: 'confetti' | 'sparks' } = {}) {
  if (!motionEnabled()) return;
  const { x, y } = pointOf(from);
  const colors = opts.colors ?? ['#f97316', '#facc15', '#22d3ee', '#a78bfa', '#4ade80', '#f472b6'];
  const count = opts.count ?? 40;
  const spread = opts.spread ?? 220;
  const root = layer();
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    const size = opts.shapes === 'sparks' ? 4 + Math.random() * 4 : 6 + Math.random() * 6;
    p.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${size}px;height:${opts.shapes === 'sparks' ? size : size * 0.5}px;background:${colors[i % colors.length]};border-radius:${opts.shapes === 'sparks' ? '50%' : '2px'};box-shadow:${opts.shapes === 'sparks' ? `0 0 8px ${colors[i % colors.length]}` : 'none'}`;
    root.appendChild(p);
    const angle = Math.random() * Math.PI * 2;
    const dist = spread * (0.4 + Math.random() * 0.6);
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - spread * 0.35;
    const spin = (Math.random() - 0.5) * 720;
    p.animate(
      [
        { transform: 'translate(-50%,-50%) rotate(0deg)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${spin}deg)`, opacity: 1, offset: 0.6 },
        { transform: `translate(calc(-50% + ${dx * 1.1}px), calc(-50% + ${dy + spread * 0.6}px)) rotate(${spin * 1.4}deg)`, opacity: 0 },
      ],
      { duration: 1100 + Math.random() * 600, easing: 'cubic-bezier(.2,.7,.3,1)' },
    ).onfinish = () => p.remove();
  }
}

/** Text that rises and fades (e.g. „+2 400 лв.“). */
export function floatText(from: Element | Point, text: string, color = '#4ade80') {
  if (!motionEnabled()) return;
  const { x, y } = pointOf(from);
  const el = document.createElement('span');
  el.textContent = text;
  el.style.cssText = `position:absolute;left:${x}px;top:${y}px;font:700 14px var(--font-display, sans-serif);color:${color};white-space:nowrap;text-shadow:0 1px 4px rgba(0,0,0,.6)`;
  layer().appendChild(el);
  el.animate(
    [
      { transform: 'translate(-50%, 0) scale(.9)', opacity: 0 },
      { transform: 'translate(-50%, -14px) scale(1.05)', opacity: 1, offset: 0.2 },
      { transform: 'translate(-50%, -42px) scale(1)', opacity: 0 },
    ],
    { duration: 1400, easing: 'ease-out' },
  ).onfinish = () => el.remove();
}

/** Small icons that fly from one place to another (a reward to the wallet). */
export function flyTo(from: Element | Point, to: Element | Point | null, icon: string, count = 6) {
  if (!motionEnabled() || !to) return;
  const a = pointOf(from);
  const b = pointOf(to);
  const root = layer();
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.textContent = icon;
    el.style.cssText = `position:absolute;left:${a.x}px;top:${a.y}px;font-size:20px;line-height:1`;
    root.appendChild(el);
    const jx = (Math.random() - 0.5) * 80;
    const jy = (Math.random() - 0.5) * 60;
    el.animate(
      [
        { transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 },
        { transform: `translate(calc(-50% + ${jx}px), calc(-50% + ${jy}px)) scale(1.1)`, opacity: 1, offset: 0.25 },
        { transform: `translate(calc(-50% + ${b.x - a.x}px), calc(-50% + ${b.y - a.y}px)) scale(.5)`, opacity: 0.2 },
      ],
      { duration: 800 + i * 70, easing: 'cubic-bezier(.5,0,.2,1)', delay: i * 40 },
    ).onfinish = () => el.remove();
  }
}

/** A short shake of an element (a legendary reveal). */
export function shake(el: Element | null) {
  if (!motionEnabled() || !el) return;
  el.animate(
    [{ transform: 'translate(0,0)' }, { transform: 'translate(-6px,2px)' }, { transform: 'translate(5px,-3px)' }, { transform: 'translate(-3px,1px)' }, { transform: 'translate(0,0)' }],
    { duration: 380, easing: 'ease-out' },
  );
}

/** Where rewards fly to: the money and ТрансКоин chips in the top bar. */
export const walletEl = () => document.querySelector('[data-fx="wallet"]');
export const coinsEl = () => document.querySelector('[data-fx="coins"]');

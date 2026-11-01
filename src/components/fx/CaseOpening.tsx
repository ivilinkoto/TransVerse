'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CASE_TABLES, ITEMS, RARITIES, pickFrom, type CaseId, type ItemId, type Rarity } from '@/lib/game/items';
import { ItemArt } from '@/components/game/ItemArt';
import { motionEnabled, playReveal, playTick } from '@/lib/client/motion';
import { burst, shake } from './fx';
import { t, tx } from '@/i18n/t';

/**
 * 1.1.4.3: opening a case. The server has already chosen the item (`result`);
 * the roulette only shows it — a strip of possible items spins and stops under
 * the marker on that item, then the item is revealed with an effect that grows
 * with its rarity. With animations off the item is shown at once.
 */
const TIER: Record<Rarity, number> = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
const CELL = 112;
const LENGTH = 44;
const STOP = 38;

export function CaseOpening({ caseId, result, error, left, onAgain, onClose }: { caseId: CaseId; result: ItemId | null; error: string | null; left: number; onAgain: () => void; onClose: () => void }) {
  const animate = useMemo(() => motionEnabled(), []);
  const [phase, setPhase] = useState<'shake' | 'spin' | 'reveal'>(animate ? 'shake' : 'reveal');
  const strip = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [shownAt] = useState(() => (typeof performance === 'undefined' ? 0 : performance.now()));

  // The strip: random items from the case table (only for show), the won one at STOP.
  const [cells, setCells] = useState<ItemId[]>([]);

  // Shake the closed case at least a moment, then spin once the server answered.
  useEffect(() => {
    if (!animate || phase !== 'shake' || !result) return;
    const wait = Math.max(0, 700 - (performance.now() - shownAt));
    const id = setTimeout(() => {
      const list = Array.from({ length: LENGTH }, () => pickFrom(CASE_TABLES[caseId], Math.random()));
      list[STOP] = result;
      setCells(list);
      setPhase('spin');
    }, wait);
    return () => clearTimeout(id);
  }, [animate, phase, result, shownAt, caseId]);

  useEffect(() => {
    if (phase !== 'spin' || !strip.current || !box.current) return;
    const width = box.current.clientWidth;
    const jitter = (Math.random() - 0.5) * (CELL * 0.6);
    const target = -(STOP * CELL + CELL / 2 - width / 2 + jitter);
    const anim = strip.current.animate([{ transform: 'translateX(0px)' }, { transform: `translateX(${target}px)` }], { duration: 4800, easing: 'cubic-bezier(0.08, 0.75, 0.15, 1)', fill: 'forwards' });
    // A tick each time a new item passes the marker.
    let last = -1;
    let frame = 0;
    const loop = () => {
      if (!strip.current || !box.current) return;
      const offset = box.current.getBoundingClientRect().left - strip.current.getBoundingClientRect().left + width / 2;
      const index = Math.floor(offset / CELL);
      if (index !== last) {
        last = index;
        playTick();
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    anim.onfinish = () => {
      cancelAnimationFrame(frame);
      setTimeout(() => setPhase('reveal'), 250);
    };
    return () => {
      cancelAnimationFrame(frame);
      anim.cancel();
    };
  }, [phase]);

  // The reveal: sound, sparks or confetti, a shake for the rarest.
  useEffect(() => {
    if (phase !== 'reveal' || !result) return;
    const tier = TIER[ITEMS[result].rarity];
    playReveal(tier);
    if (!animate || !card.current) return;
    const color = RARITIES[ITEMS[result].rarity].color;
    if (tier >= 1) burst(card.current, { colors: [color, '#ffffff', '#fde68a'], count: 14 + tier * 10, spread: 120 + tier * 50, shapes: tier >= 3 ? 'confetti' : 'sparks' });
    if (tier >= 4) {
      setTimeout(() => burst(card.current!, { count: 70, spread: 340 }), 250);
      shake(box.current?.closest('[role="dialog"]') ?? null);
    }
  }, [phase, result, animate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && phase === 'reveal' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onClose]);

  const def = result ? ITEMS[result] : null;
  const rarity = def ? RARITIES[def.rarity] : null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-asphalt-950/85 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={tx(ITEMS[caseId].name)}>
      <div className="w-full max-w-xl space-y-5 text-center">
        <p className="font-display text-lg font-bold">{tx(ITEMS[caseId].name)}</p>

        {error ? (
          <div className="space-y-3">
            <p role="alert" className="text-loss">{error}</p>
            <button type="button" className="btn-ghost" onClick={onClose}>{t('Затвори')}</button>
          </div>
        ) : phase === 'shake' ? (
          <div className="relative mx-auto h-48 w-48">
            <div className="absolute inset-0 rounded-full fx-glow" style={{ background: 'radial-gradient(closest-side, rgba(250,204,21,.45), transparent)' }} />
            <div className="fx-case-wobble relative h-full w-full"><ItemArt id={caseId} className="h-full w-full" /></div>
          </div>
        ) : phase === 'spin' ? (
          <div ref={box} className="relative overflow-hidden rounded-2xl border border-asphalt-700 bg-asphalt-900/80 py-3">
            <div className="pointer-events-none absolute inset-y-0 left-1/2 z-10 w-0.5 -translate-x-1/2 bg-gold-400 shadow-[0_0_12px_rgba(250,204,21,.9)]" />
            <div className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 border-x-8 border-t-[10px] border-x-transparent border-t-gold-400" />
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-asphalt-950 to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-asphalt-950 to-transparent" />
            <div ref={strip} className="flex will-change-transform" style={{ width: cells.length * CELL }}>
              {cells.map((id, i) => (
                <div key={i} className="shrink-0 px-1" style={{ width: CELL }}>
                  <div className="flex h-28 flex-col items-center justify-center rounded-xl border-2 bg-asphalt-850" style={{ borderColor: RARITIES[ITEMS[id].rarity].color, boxShadow: `inset 0 -18px 24px -18px ${RARITIES[ITEMS[id].rarity].color}` }}>
                    <ItemArt id={id} className="h-16 w-16" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : def && rarity && result ? (
          <div ref={box} className="space-y-4">
            <div className="relative mx-auto h-56 w-56">
              {TIER[def.rarity] >= 2 && <div className="fx-rays absolute -inset-10 rounded-full opacity-70" style={{ background: `repeating-conic-gradient(from 0deg, ${rarity.color}55 0 8deg, transparent 8deg 22deg)`, maskImage: 'radial-gradient(closest-side, #000 35%, transparent 75%)', WebkitMaskImage: 'radial-gradient(closest-side, #000 35%, transparent 75%)' }} />}
              <div className="absolute inset-4 rounded-full fx-glow" style={{ background: `radial-gradient(closest-side, ${rarity.color}66, transparent)` }} />
              <div ref={card} className="fx-pop relative flex h-full w-full items-center justify-center rounded-3xl border-4 bg-asphalt-900" style={{ borderColor: rarity.color, boxShadow: `0 0 40px ${rarity.color}88` }}>
                <ItemArt id={result} className="h-36 w-36" />
              </div>
            </div>
            <div className="fx-pop" style={{ animationDelay: '120ms' }}>
              <p className="text-sm font-bold uppercase tracking-widest" style={{ color: rarity.color }}>{tx(rarity.label)}</p>
              <p className="font-display text-2xl font-bold">{tx(def.name)}</p>
              <p className="mt-1 text-sm text-mist-300">{tx(def.effect)}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" className="btn-primary" onClick={onClose} autoFocus>{t('Вземи')}</button>
              {left > 0 && <button type="button" className="btn-ghost" onClick={onAgain}>{t('Отвори още един ({0})', left)}</button>}
            </div>
          </div>
        ) : (
          <p className="text-mist-400">…</p>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** 1.1.4.3: „Отвори всички“ — the results of several cases, shown one after another. */
export function CaseResults({ results, onClose }: { results: ItemId[]; onClose: () => void }) {
  const best = results.reduce<ItemId | null>((b, id) => (!b || TIER[ITEMS[id].rarity] > TIER[ITEMS[b].rarity] ? id : b), null);
  useEffect(() => {
    if (best) playReveal(TIER[ITEMS[best].rarity]);
  }, [best]);
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-asphalt-950/85 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t('Отворени кейсове')}>
      <div className="w-full max-w-2xl space-y-4 text-center">
        <p className="font-display text-xl font-bold">{t('Отворени кейсове: {0}', results.length)}</p>
        <ul className="flex flex-wrap justify-center gap-2">
          {results.map((id, i) => (
            <li key={i} className="fx-pop flex w-[30%] flex-col items-center gap-1 rounded-2xl border-2 bg-asphalt-900 p-2 sm:w-28" style={{ borderColor: RARITIES[ITEMS[id].rarity].color, animationDelay: `${i * 90}ms` }}>
              <ItemArt id={id} className="h-14 w-14" />
              <span className="line-clamp-2 text-[11px] font-medium leading-tight">{tx(ITEMS[id].name)}</span>
            </li>
          ))}
        </ul>
        <button type="button" className="btn-primary" onClick={onClose} autoFocus>{t('Вземи всичко')}</button>
      </div>
    </div>,
    document.body,
  );
}

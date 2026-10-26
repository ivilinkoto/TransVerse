'use client';

import { Compass } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFeature, useFeatures } from './Features';
import { ACCOUNT_MENU, SECTIONS } from './nav';
import { t as tr, tx } from '@/i18n/t';

/** Extra words people search for, by page. */
const KEYWORDS: Record<string, string> = {
  '/game/contracts': 'товари поръчки борса курс работа',
  '/game/fleet': 'камиони автопарк превозни средства',
  '/game/garage': 'ремонт сервиз ремарке прикачи гуми подобрения',
  '/game/market': 'купи камион ремарке пазар втора ръка',
  '/game/staff': 'шофьори наеми екипаж',
  '/game/licences': 'лиценз хладилен опасни адр митница',
  '/game/finance': 'пари глоби сметка дизел гориво',
  '/game/shop': 'транскоин vip магазин боя',
  '/game/road': 'cb радио сигнал полиция задръстване автостоп',
  '/game/shares': 'акции борса дивидент инвестиция',
  '/game/postcards': 'картички забележителности',
  '/game/company': 'компания каса членове',
  '/game/map': 'карта камиони на живо',
  '/game/help': 'помощ правила речник',
  '/game/settings': 'настройки меню изглед',
};

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

/** v1.9: Ctrl+K — type a word, go to the page. */
export function CommandPalette() {
  const live = useFeature('command_palette');
  const has = useFeatures();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const profile = tr('Профил');
  const items = useMemo(
    () => [
      ...SECTIONS.flatMap((s) => (s.tabs?.length ? s.tabs.filter((t) => !t.feature || has(t.feature)).map((t) => ({ href: t.href, label: t.label, where: s.label })) : [{ href: s.href, label: s.label, where: '' }])),
      ...ACCOUNT_MENU.map((m) => ({ href: m.href, label: m.label, where: profile })),
    ].filter((x, i, all) => all.findIndex((y) => y.href === x.href) === i),
    [has, profile],
  );
  const found = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return items.slice(0, 8);
    return items.filter((it) => words.every((w) => norm(`${it.label} ${it.where} ${KEYWORDS[it.href] ?? ''}`).includes(w))).slice(0, 8);
  }, [q, items]);

  useEffect(() => {
    if (!live) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setQ('');
        setSel(0);
        setOpen((o) => !o);
      } else if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [live]);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0);
  }, [open]);
  if (!live) return null;
  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  return (
    <>
      <button type="button" onClick={() => { setQ(''); setSel(0); setOpen(true); }} className="flex h-9 w-9 items-center justify-center rounded-full border border-asphalt-700 text-mist-300 transition hover:text-white" title={tr('Къде искаш да отидеш? (Ctrl+K)')} aria-label={tr('Търси страница')}>
        <Compass className="h-4 w-4" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label={tr('Търси страница')} onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl border border-asphalt-700 bg-asphalt-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <input
              ref={input}
              className="w-full rounded-t-2xl bg-transparent px-4 py-3 text-base outline-none"
              placeholder={tr('Къде искаш да отидеш? (напр. ремарке, акции, глоби)')}
              value={q}
              onChange={(e) => { setQ(e.target.value); setSel(0); }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(found.length - 1, x + 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(0, x - 1)); }
                else if (e.key === 'Enter' && found[sel]) go(found[sel]!.href);
              }}
              aria-label={tr('Търсене')}
            />
            <ul className="max-h-80 overflow-y-auto border-t border-asphalt-800 p-1.5">
              {found.length === 0 && <li className="px-3 py-2 text-sm text-mist-400">{tr('Нищо не намерих. Опитай с друга дума.')}</li>}
              {found.map((it, i) => (
                <li key={it.href}>
                  <button type="button" onMouseEnter={() => setSel(i)} onClick={() => go(it.href)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${i === sel ? 'bg-asphalt-700 text-white' : 'text-mist-200'}`}>
                    <span>{tx(it.label)}</span>
                    {it.where && <span className="text-xs text-mist-400">{tx(it.where)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

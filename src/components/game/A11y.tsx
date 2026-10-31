'use client';

import { useEffect, useState } from 'react';
import { t } from '@/i18n/t';

/**
 * 1.1.4.2: bigger text and colours for colour blindness. A per-browser
 * convenience (localStorage); the page works the same without it.
 */
const KEYS = { text: 'tv:a11y-text', colors: 'tv:a11y-colors' } as const;

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function apply() {
  const html = document.documentElement;
  const text = read(KEYS.text);
  const colors = read(KEYS.colors);
  if (text === 'large') html.dataset.text = 'large';
  else delete html.dataset.text;
  if (colors === 'cb') html.dataset.colors = 'cb';
  else delete html.dataset.colors;
}

/** In the game layout: applies the saved choice. */
export function A11yApply() {
  useEffect(() => apply(), []);
  return null;
}

/** In Settings: the two switches. */
export function A11ySettings() {
  const [state, setState] = useState<{ large: boolean; cb: boolean } | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setState({ large: read(KEYS.text) === 'large', cb: read(KEYS.colors) === 'cb' }), 0);
    return () => clearTimeout(id);
  }, []);
  const set = (key: 'large' | 'cb', on: boolean) => {
    try {
      if (key === 'large') localStorage.setItem(KEYS.text, on ? 'large' : '');
      else localStorage.setItem(KEYS.colors, on ? 'cb' : '');
    } catch {
      /* storage unavailable: applies until the page reloads */
    }
    setState((s) => ({ large: s?.large ?? false, cb: s?.cb ?? false, [key]: on }));
    apply();
    if (key === 'large') document.documentElement.dataset.text = on ? 'large' : '';
    if (key === 'cb') document.documentElement.dataset.colors = on ? 'cb' : '';
  };
  return (
    <div className="space-y-2 text-sm">
      <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-cyan-500" checked={!!state?.large} onChange={(e) => set('large', e.target.checked)} />{t('Голям текст')}</label>
      <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-cyan-500" checked={!!state?.cb} onChange={(e) => set('cb', e.target.checked)} />{t('Цветове за цветна слепота (синьо и оранжево вместо зелено и червено)')}</label>
      <p className="text-xs text-mist-400">{t('Запомня се на това устройство.')}</p>
    </div>
  );
}

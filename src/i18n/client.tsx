'use client';

import { createContext, use, useEffect, type ReactNode } from 'react';
import { DEFAULT_LOCALE, type Locale } from './config';
import { setResolver, type Messages } from './t';

type Value = { locale: Locale; messages: Messages | null };
const I18nContext = createContext<Value | null>(null);
// Outside rendering (event handlers) the browser has one player: the last language rendered.
let last: Value = { locale: DEFAULT_LOCALE, messages: null };

setResolver(() => {
  // In the browser there is one player and one language: the provider keeps `last` current while it renders,
  // so t() works the same in rendering, effects and event handlers (React warns about `use` inside effects).
  if (typeof window !== 'undefined') return last;
  // Server rendering of client components: each request has its own provider.
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const v = use(I18nContext);
    if (v) return v;
  } catch {
    // not during rendering
  }
  return last;
});

export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: Messages | null; children: ReactNode }) {
  const value = { locale, messages };
  // Before the children render, so their t() already has this language.
  // eslint-disable-next-line react-hooks/globals -- one player per browser: the language is global by design
  if (typeof window !== 'undefined') last = value;
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return <I18nContext value={value}>{children}</I18nContext>;
}

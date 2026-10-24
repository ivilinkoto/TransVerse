'use client';

import { createContext, use, useEffect, type ReactNode } from 'react';
import { DEFAULT_LOCALE, type Locale } from './config';
import { setResolver, type Messages } from './t';

type Value = { locale: Locale; messages: Messages | null };
const I18nContext = createContext<Value | null>(null);
// Outside rendering (event handlers) the browser has one player: the last language rendered.
let last: Value = { locale: DEFAULT_LOCALE, messages: null };

setResolver(() => {
  try {
    // A plain function used while rendering: `use` reads the provider; outside rendering it throws.
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
  useEffect(() => {
    last = { locale, messages };
    document.documentElement.lang = locale;
  }, [locale, messages]);
  return <I18nContext value={value}>{children}</I18nContext>;
}

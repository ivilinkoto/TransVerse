'use client';

import { Languages } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { LOCALE_FLAGS, LOCALE_LABELS, LOCALES, type Locale } from '@/i18n/config';
import { currentLocale } from '@/i18n/t';

/** Български / English / Русский — remembered in a cookie and in the profile. */
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [locale, setLocale] = useState<Locale>(currentLocale());
  const choose = async (next: Locale) => {
    setLocale(next);
    await fetch('/api/locale', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale: next }) });
    start(() => router.refresh());
  };
  return (
    <label className={`inline-flex items-center gap-1.5 text-xs text-mist-300 ${pending ? 'opacity-60' : ''}`}>
      <Languages className="h-4 w-4" aria-hidden />
      <select className="rounded-lg border border-asphalt-700 bg-asphalt-900 px-1.5 py-1 text-xs text-white" value={locale} onChange={(e) => choose(e.target.value as Locale)} aria-label="Language / Език / Язык">
        {LOCALES.map((l) => <option key={l} value={l}>{compact ? LOCALE_FLAGS[l] : LOCALE_LABELS[l]}</option>)}
      </select>
    </label>
  );
}

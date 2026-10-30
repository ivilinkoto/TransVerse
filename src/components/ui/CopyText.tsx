'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { t } from '@/i18n/t';

/** 1.1.3.5: a small button that copies a text (a plate, a code) to the clipboard. */
export function CopyText({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* no clipboard (an old browser, no permission): nothing to do */
    }
  };
  return (
    <button type="button" onClick={copy} className="inline-flex items-center rounded p-0.5 align-middle text-mist-500 transition hover:text-white" title={done ? t('Копирано') : t('Копирай {0}', label ?? text)} aria-label={done ? t('Копирано') : t('Копирай {0}', label ?? text)}>
      {done ? <Check className="h-3 w-3 text-profit" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

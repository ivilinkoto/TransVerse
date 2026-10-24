'use client';

import { Lightbulb, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { HINTS, type HintId } from '@/lib/game/hints';
import { t, tx } from '@/i18n/t';

/** A one-time hint about a game system; closing it is remembered on the server. */
export function Hint({ id }: { id: HintId }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const hint = HINTS[id];
  const close = () => {
    setOpen(false);
    void api('/api/game/action', { type: 'dismissHint', hint: id }).catch(() => undefined);
  };
  return (
    <div role="note" className="mb-4 flex gap-3 rounded-2xl border border-gold-400/30 bg-gold-400/5 p-3.5 text-sm">
      <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-gold-400" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{tx(hint.title)}</div>
        <p className="mt-0.5 text-mist-300">{tx(hint.body)}</p>
        <Link href="/game/help" className="mt-1 inline-block text-xs text-cyan-glow hover:underline">{t('Всички правила — Помощ')}</Link>
      </div>
      <button type="button" onClick={close} className="self-start rounded-full p-1 text-mist-400 hover:bg-asphalt-800 hover:text-white" aria-label={t('Разбрах, скрий')}><X className="h-4 w-4" /></button>
    </div>
  );
}

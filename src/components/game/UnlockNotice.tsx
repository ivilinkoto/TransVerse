'use client';

import { Unlock } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/client/api';

/** v1.9: "Ново за теб" — a page the player just unlocked, with a short how-to. */
export function UnlockNotice({ items }: { items: { href: string; label: string; section: string; text: string; steps: string[] }[] }) {
  const [open, setOpen] = useState(true);
  const first = items[0];
  if (!open || !first) return null;
  const done = (all: boolean) => {
    setOpen(false);
    void api('/api/game/action', { type: 'uiPrefs', seenUnlocks: all ? items.map((i) => i.href) : [first.href] }).catch(() => undefined);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="unlock-title">
      <div className="w-full max-w-md rounded-2xl border border-cyan-glow/40 bg-asphalt-900 p-5 shadow-2xl">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-cyan-glow"><Unlock className="h-4 w-4" />Ново за теб · {first.section}</div>
        <h2 id="unlock-title" className="mt-2 font-display text-xl font-bold">{first.label}</h2>
        <p className="mt-1 text-sm text-mist-300">{first.text}</p>
        <ol className="mt-3 space-y-1.5 text-sm">
          {first.steps.map((s, i) => <li key={s} className="flex gap-2"><span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-glow/15 text-[11px] font-bold text-cyan-glow">{i + 1}</span>{s}</li>)}
        </ol>
        {items.length > 1 && <p className="mt-3 text-xs text-mist-400">Отключени са още {items.length - 1} страници — ще ги видиш в менюто.</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => done(true)}>Разбрах</button>
          <Link href={first.href} className="btn-primary" onClick={() => done(false)}>Покажи ми</Link>
        </div>
      </div>
    </div>
  );
}

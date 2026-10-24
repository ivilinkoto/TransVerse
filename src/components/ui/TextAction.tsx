'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { tx } from '@/i18n/t';

/** A short text (and optionally a number) sent with a game action — names, tags, messages. */
export function TextAction({ label, action, field, placeholder, ariaLabel, maxLength = 60, number, endpoint = '/api/game/action' }: { label: string; action: Record<string, unknown>; field: string; placeholder?: string; ariaLabel: string; maxLength?: number; number?: { field: string; label: string; min: number; max: number; value: number }; endpoint?: string }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [n, setN] = useState(number?.value ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(endpoint, { ...action, [field]: text, ...(number ? { [number.field]: n } : {}) });
      setText('');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-1">
      <div className="flex flex-wrap gap-2">
        <input className="input min-w-0 flex-1 py-2 text-sm" value={text} maxLength={maxLength} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={ariaLabel} />
        {number && (
          <label className="flex items-center gap-1 text-xs text-mist-300">
            <input type="number" className="input w-20 py-2 text-sm" min={number.min} max={number.max} value={n} onChange={(e) => setN(Number(e.target.value))} aria-label={tx(number.label)} />
            {tx(number.label)}
          </label>
        )}
        <button className="btn-primary py-2" disabled={busy || !text.trim()}>{busy ? '…' : label}</button>
      </div>
      {error && <p role="alert" className="text-xs text-loss">{error}</p>}
    </form>
  );
}

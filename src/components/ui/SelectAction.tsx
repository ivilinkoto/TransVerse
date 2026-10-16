'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';

/**
 * A select whose choice is sent as a game action: `action` plus `{ [field]: value }`.
 * Empty choice becomes null; `numeric` converts the value to a number.
 */
export function SelectAction({ label, options, value, action, field, numeric = false, ariaLabel }: { label: string; options: { value: string; label: string; disabled?: boolean }[]; value: string; action: Record<string, unknown>; field: string; numeric?: boolean; ariaLabel: string }) {
  const router = useRouter();
  const [current, setCurrent] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', { ...action, [field]: current === '' ? null : numeric ? Number(current) : current });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <select className="input min-w-0 flex-1 py-2 text-sm" value={current} onChange={(e) => setCurrent(e.target.value)} aria-label={ariaLabel}>
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
          ))}
        </select>
        <button className="btn-ghost py-2" onClick={save} disabled={busy || current === value}>{busy ? '…' : label}</button>
      </div>
      {error && <p role="alert" className="text-xs text-loss">{error}</p>}
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { api } from '@/lib/client/api';

/** Posts a game action, shows the server's message on failure and refreshes data on success. */
export function ActionButton({ action, children, className = 'btn-ghost', confirm, onDone, disabled }: { action: Record<string, unknown>; children: ReactNode; className?: string; confirm?: string; onDone?: () => void; disabled?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', action);
      setAsking(false);
      onDone?.();
      startTransition(() => router.refresh());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (confirm && asking) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2 text-sm">
        <span className="text-mist-300">{confirm}</span>
        <button className="btn-danger px-3 py-1.5" onClick={run} disabled={busy}>Потвърди</button>
        <button className="btn-ghost px-3 py-1.5" onClick={() => setAsking(false)}>Отказ</button>
        {error && <span role="alert" className="w-full text-xs text-loss">{error}</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <button className={className} onClick={() => (confirm ? setAsking(true) : run())} disabled={disabled || busy || pending}>
        {busy || pending ? '…' : children}
      </button>
      {error && <span role="alert" className="max-w-xs text-xs text-loss">{error}</span>}
    </span>
  );
}

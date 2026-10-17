'use client';

import { Copy, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/client/api';

/** Creates a one-time password link to hand over to a player through support. */
export function ResetLinkButton({ userId }: { userId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!window.confirm('Да създадем ли линк за нова парола? Изпратете го само на собственика на профила (напр. в тикет за поддръжка).')) return;
    setBusy(true);
    setError(null);
    try {
      setUrl((await api<{ url: string }>('/api/admin/action', { type: 'resetLink', userId })).url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={create} disabled={busy}><KeyRound className="h-4 w-4" />Линк за нова парола</button>
      {url && (
        <div className="flex items-center gap-2 rounded-lg border border-asphalt-700 bg-asphalt-850 p-2">
          <input readOnly value={url} className="input flex-1 py-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} aria-label="Линк за нова парола" />
          <button type="button" className="btn-ghost px-2 py-1" onClick={() => void navigator.clipboard?.writeText(url)} aria-label="Копирай"><Copy className="h-4 w-4" /></button>
        </div>
      )}
      {url && <p className="text-xs text-mist-400">Важи 1 час, еднократен. Действието е записано в одит дневника.</p>}
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { RECRUITMENT_BOARD } from '@/lib/game/recruitment';

/** A post on the recruitment board (v1.6): for the company or for the driver. */
export function RecruitmentForm({ kind, placeholder, minLevel }: { kind: 'company' | 'driver'; placeholder: string; minLevel?: number }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [level, setLevel] = useState(minLevel ?? 1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', { type: 'postRecruitment', kind, text, ...(kind === 'company' ? { minLevel: level } : {}) });
      setText('');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <textarea className="input min-h-24 w-full" maxLength={RECRUITMENT_BOARD.maxText} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {kind === 'company' && (
          <label className="flex items-center gap-2">Минимално ниво <input type="number" className="input w-20" min={1} max={RECRUITMENT_BOARD.maxLevel} value={level} onChange={(e) => setLevel(Number(e.target.value) || 1)} /></label>
        )}
        <span className="text-xs text-mist-400">{text.length} / {RECRUITMENT_BOARD.maxText} · обявата стои {RECRUITMENT_BOARD.days} дни</span>
        <button type="button" className="btn-primary ml-auto" disabled={busy || text.trim().length < 10} onClick={submit}>Публикувай</button>
      </div>
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
    </div>
  );
}

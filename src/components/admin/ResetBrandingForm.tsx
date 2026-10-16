'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';

/** Moderation: clears a company's logo, banner and texts (audited on the server). */
export function ResetBrandingForm({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/action', { type: 'resetCompanyBranding', companyId, reason });
      setDone(true);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина (напр. неподходящо лого)" maxLength={300} aria-label="Причина за изчистване" />
      <button className="btn-danger" onClick={run} disabled={busy}>{busy ? '…' : 'Изчисти лого, банер и текстове'}</button>
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
      {done && <p role="status" className="text-sm text-profit">Профилът на компанията е изчистен.</p>}
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { t } from '@/i18n/t';

export function BanForm({ userId, banned }: { userId: string; banned: boolean }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/action', banned ? { type: 'unban', userId } : { type: 'ban', userId, reason });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      {!banned && <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('Причина за блокиране')} maxLength={300} aria-label={t('Причина за блокиране')} />}
      <button className={banned ? 'btn-ghost' : 'btn-danger'} onClick={run} disabled={busy}>{busy ? '…' : banned ? t('Отблокирай') : t('Блокирай достъпа')}</button>
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
    </div>
  );
}

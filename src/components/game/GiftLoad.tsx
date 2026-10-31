'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { t } from '@/i18n/t';

/** 1.1.4.2 „Подари курс“: the load goes to a friend (kept for them 2 hours, +5%). */
export function GiftLoad({ contractId, friends }: { contractId: string; friends: { id: string; username: string }[] }) {
  const router = useRouter();
  const [friendId, setFriendId] = useState(friends[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const give = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', { type: 'giftLoad', contractId, friendId });
      setNote(t('🎁 Подарено — пази се за приятеля ти 2 часа.'));
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-asphalt-700 bg-asphalt-900/60 p-2 text-sm">
      <span className="text-mist-300">{t('🎁 Подари на приятел:')}</span>
      <select className="input w-auto py-1 text-sm" value={friendId} onChange={(e) => setFriendId(e.target.value)} aria-label={t('Приятел')}>
        {friends.map((f) => <option key={f.id} value={f.id}>{f.username}</option>)}
      </select>
      <button type="button" className="btn-ghost px-3 py-1 text-xs" disabled={busy || !friendId} onClick={give}>{busy ? '…' : t('Подари (+5% за него)')}</button>
      {note && <span className="text-profit">{note}</span>}
      {error && <span role="alert" className="text-loss">{error}</span>}
    </div>
  );
}

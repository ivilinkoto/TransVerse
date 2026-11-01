'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { ITEMS, ITEM_IDS, RARITIES, type ItemId } from '@/lib/game/items';
import { ItemArt } from '@/components/game/ItemArt';
import { t, tx } from '@/i18n/t';

/** 1.2: an administrator gives cases or items to a player (with a reason; the player is told). */
export function ItemGrantForm({ userId }: { userId: string }) {
  const router = useRouter();
  const choices = ITEM_IDS.filter((id) => ITEMS[id].kind !== 'coins');
  const cases = choices.filter((id) => ITEMS[id].kind === 'case');
  const [itemId, setItemId] = useState<ItemId>('case_bronze');
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await api('/api/admin/action', { type: 'grantItem', userId, itemId, qty: Number(qty), reason });
      setDone(t('Дадено: {0} ×{1}', tx(ITEMS[itemId].name), qty));
      setReason('');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const n = Number(qty);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {cases.map((id) => (
          <button key={id} type="button" onClick={() => setItemId(id)} aria-pressed={itemId === id} className={`flex items-center gap-1.5 rounded-xl border-2 bg-asphalt-900 px-2 py-1 text-xs font-semibold ${itemId === id ? 'ring-2 ring-white/40' : ''}`} style={{ borderColor: RARITIES[ITEMS[id].rarity].color }}>
            <ItemArt id={id} className="h-7 w-7" />{tx(ITEMS[id].name)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <select className="input min-w-0 flex-1" value={itemId} onChange={(e) => setItemId(e.target.value as ItemId)} aria-label={t('Предмет')}>
          {choices.map((id) => <option key={id} value={id}>{tx(ITEMS[id].name)} · {tx(RARITIES[ITEMS[id].rarity].label)}</option>)}
        </select>
        <input className="input w-20" type="number" min={1} max={100} step={1} value={qty} onChange={(e) => setQty(e.target.value)} aria-label={t('Брой')} />
      </div>
      <input className="input w-full" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('Причина (играчът я вижда; напр. награда от турнир)')} maxLength={300} aria-label={t('Причина')} />
      <button className="btn-gold" disabled={busy || !Number.isInteger(n) || n < 1 || n > 100 || reason.trim().length < 3} onClick={run}>{busy ? '…' : t('Дай {0} ×{1}', tx(ITEMS[itemId].name), Number.isInteger(n) ? n : 0)}</button>
      {done && <p role="status" className="text-sm text-profit">{done}</p>}
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
    </div>
  );
}

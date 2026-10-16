'use client';

import { ShoppingCart } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';

/** Purchase with depot selection (vehicles are delivered to one of your depots). */
export function BuyButton({ type, modelId, depots, disabledReason, label }: { type: 'buyVehicle' | 'buyTrailer' | 'rentVehicle'; modelId: string; depots: { cityId: number; name: string; free: number }[]; disabledReason: string | null; label: string }) {
  const router = useRouter();
  const [cityId, setCityId] = useState(depots[0]?.cityId ?? 0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const buy = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api('/api/game/action', type === 'rentVehicle' ? { type, offerId: modelId, cityId } : { type, modelId, cityId });
      setMessage({ ok: true, text: type === 'rentVehicle' ? 'Наето! Назначете шофьор в „Служители“.' : 'Купено! Вижте го в автопарка.' });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <select className="input w-auto min-w-0 flex-1 py-2 text-sm" value={cityId} onChange={(e) => setCityId(Number(e.target.value))} aria-label="Депо за доставка">
          {depots.map((d) => (
            <option key={d.cityId} value={d.cityId}>
              Депо {d.name}{type !== 'buyTrailer' ? ` (${d.free} свободни)` : ''}
            </option>
          ))}
        </select>
        <button className="btn-gold" onClick={buy} disabled={busy || !!disabledReason} title={disabledReason ?? undefined}>
          <ShoppingCart className="h-4 w-4" />{busy ? '…' : label}
        </button>
      </div>
      {disabledReason && <p className="text-xs text-mist-400">{disabledReason}</p>}
      {message && <p role="status" className={`text-xs ${message.ok ? 'text-profit' : 'text-loss'}`}>{message.text}</p>}
    </div>
  );
}

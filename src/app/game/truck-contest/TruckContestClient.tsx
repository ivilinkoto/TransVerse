'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';

export function EnterTruck({ vehicles }: { vehicles: { id: string; label: string }[] }) {
  const router = useRouter();
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select className="input min-w-0 flex-1" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} aria-label="Камион">
        {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
      </select>
      <button
        type="button"
        className="btn-primary"
        disabled={busy || !vehicleId}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api('/api/game/action', { type: 'enterTruck', vehicleId });
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        🚛 Включи в конкурса
      </button>
      <p className="w-full text-xs text-mist-400">Камионът участва така, както изглежда сега — един на месец.</p>
      {error && <p role="alert" className="w-full text-loss">{error}</p>}
    </div>
  );
}

export function VoteButton({ entryId, voted, disabled }: { entryId: number; voted: boolean; disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (voted) return <p className="mt-2 text-xs text-profit">✓ Гласува за него</p>;
  return (
    <div className="mt-2">
      <button
        type="button"
        className="btn-ghost w-full px-3 py-1.5 text-xs"
        disabled={busy || disabled}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api('/api/game/action', { type: 'voteTruck', entryId });
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        👍 Гласувай
      </button>
      {error && <p role="alert" className="mt-1 text-xs text-loss">{error}</p>}
    </div>
  );
}

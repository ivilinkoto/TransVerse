'use client';

import { Coins } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { COSMETIC_IDS, COSMETIC_PARTS } from '@/lib/game/cosmetics';
import type { ShopItem } from '@/lib/game/shop';

export interface VehicleOption {
  id: string;
  label: string;
  owned: boolean;
  idle: boolean;
}

/** One shop product: the inputs it needs, the price and the buy button. */
export function ShopBuy({
  item,
  balance,
  vip,
  vehicles,
  cities,
  colors,
  vipColors,
}: {
  item: ShopItem;
  balance: number;
  vip: boolean;
  vehicles: VehicleOption[];
  cities: { id: number; name: string }[];
  colors: string[];
  vipColors: string[];
}) {
  const router = useRouter();
  const usable = vehicles.filter((v) => (item.needs === 'vehicle_city' ? v.idle : v.owned && (item.needs !== 'vehicle' || v.idle)));
  const [vehicleId, setVehicleId] = useState(usable[0]?.id ?? '');
  const [cityId, setCityId] = useState('');
  const [text, setText] = useState('');
  const [color, setColor] = useState(colors[0] ?? '');
  const [cosmetic, setCosmetic] = useState('grille:chrome');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const price = item.id === 'paint' && vip ? 0 : item.needs === 'vehicle_cosmetic' ? COSMETIC_PARTS[cosmetic.split(':')[0] as keyof typeof COSMETIC_PARTS].price : item.price;
  const needsVehicle = item.needs?.startsWith('vehicle');
  const missing = (needsVehicle && !vehicleId) || (item.needs === 'vehicle_city' && !cityId) || ((item.needs === 'vehicle_plate' || item.needs === 'username' || item.needs === 'recipient') && text.trim().length < 2);

  const buy = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await api<{ summary: string }>('/api/game/action', {
        type: 'shopBuy',
        purchase: {
          item: item.id,
          vehicleId: needsVehicle ? vehicleId : undefined,
          cityId: item.needs === 'vehicle_city' ? Number(cityId) : undefined,
          plate: item.needs === 'vehicle_plate' ? text : undefined,
          color: item.needs === 'vehicle_color' ? color : undefined,
          cosmetic: item.needs === 'vehicle_cosmetic' ? cosmetic : undefined,
          username: item.needs === 'username' ? text : undefined,
          recipient: item.needs === 'recipient' ? text : undefined,
        },
      });
      setDone(res.summary);
      setConfirming(false);
      setText('');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {needsVehicle && (
        usable.length ? (
          <select className="input py-2 text-sm" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} aria-label="Камион">
            {usable.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        ) : (
          <p className="text-xs text-mist-400">{item.needs === 'vehicle_city' ? 'Нямаш свободен камион.' : 'Нямаш подходящ собствен камион.'}</p>
        )
      )}
      {item.needs === 'vehicle_city' && (
        <select className="input py-2 text-sm" value={cityId} onChange={(e) => setCityId(e.target.value)} aria-label="Град">
          <option value="">— град —</option>
          {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      {item.needs === 'vehicle_cosmetic' && (
        <select className="input py-2 text-sm" value={cosmetic} onChange={(e) => setCosmetic(e.target.value)} aria-label="Част">
          {COSMETIC_IDS.map((part) => (
            <optgroup key={part} label={`${COSMETIC_PARTS[part].label} · ${COSMETIC_PARTS[part].price} TC`}>
              {COSMETIC_PARTS[part].styles.map((st) => <option key={st.id} value={`${part}:${st.id}`}>{COSMETIC_PARTS[part].label}: {st.label}</option>)}
            </optgroup>
          ))}
        </select>
      )}
      {item.needs === 'vehicle_plate' && <input className="input py-2 text-sm uppercase" maxLength={10} value={text} onChange={(e) => setText(e.target.value.toUpperCase())} placeholder="TRANS 1" aria-label="Надпис на табелата" />}
      {item.needs === 'username' && <input className="input py-2 text-sm" maxLength={20} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ново потребителско име" aria-label="Ново потребителско име" />}
      {item.needs === 'recipient' && <input className="input py-2 text-sm" maxLength={20} value={text} onChange={(e) => setText(e.target.value)} placeholder="Потребителско име на играча" aria-label="Получател" />}
      {item.needs === 'vehicle_color' && (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Цвят">
          {[...colors, ...vipColors].map((c) => {
            const locked = vipColors.includes(c) && !vip;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={locked ? `${c} (само VIP)` : c}
                disabled={locked}
                onClick={() => setColor(c)}
                className={`h-7 w-7 rounded-full border-2 ${color === c ? 'border-white' : 'border-asphalt-600'} ${locked ? 'opacity-30' : ''} ${vipColors.includes(c) ? 'ring-1 ring-gold-400/60' : ''}`}
                style={{ background: c }}
                title={locked ? 'Само за VIP' : undefined}
              />
            );
          })}
        </div>
      )}
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{price ? `Да платиш ${price} TC?` : 'Потвърди (безплатно за VIP)'}</span>
          <button className="btn-gold px-3 py-1.5" onClick={buy} disabled={busy}>{busy ? '…' : 'Потвърди'}</button>
          <button className="btn-ghost px-3 py-1.5" onClick={() => setConfirming(false)}>Отказ</button>
        </div>
      ) : (
        <button className="btn-gold w-full py-2 text-sm" disabled={busy || missing || balance < price} onClick={() => setConfirming(true)}>
          <Coins className="h-4 w-4" />{balance < price ? `Нужни са ${price} TC` : price ? `Купи · ${price} TC` : 'Приложи · безплатно (VIP)'}
        </button>
      )}
      {error && <p role="alert" className="text-xs text-loss">{error}</p>}
      {done && <p role="status" className="text-xs text-profit">Готово: {done}</p>}
    </div>
  );
}

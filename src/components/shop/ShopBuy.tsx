'use client';

import { Coins } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { COSMETIC_IDS, COSMETIC_PARTS, TRAILER_COSMETIC_IDS, TRAILER_COSMETIC_PARTS } from '@/lib/game/cosmetics';
import type { ShopItem } from '@/lib/game/shop';
import { useFeature } from '@/components/game/Features';
import { GameWindow } from '@/components/gameui/GameWindow';
import { playCoin, playSelect } from '@/lib/client/motion';
import { SHOP_EMOJI as EMOJI } from '@/lib/game/shop-look';
import { t as tr, tx } from '@/i18n/t';


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
  trailers = [],
  depots = [],
  compact = false,
}: {
  item: ShopItem;
  balance: number;
  vip: boolean;
  vehicles: VehicleOption[];
  cities: { id: number; name: string }[];
  colors: string[];
  vipColors: string[];
  /** Own trailers (for trailer parts). */
  trailers?: { id: string; label: string }[];
  /** 1.2.3: own depots (for „Преместване на депо“). */
  depots?: { id: string; label: string }[];
  /** 1.2.3.6: in a store card the price is shown above, so the button just says „Купи“. */
  compact?: boolean;
}) {
  const router = useRouter();
  const usable = vehicles.filter((v) => (item.needs === 'vehicle_city' ? v.idle : v.owned && (item.needs !== 'vehicle' || v.idle)));
  const [vehicleId, setVehicleId] = useState(usable[0]?.id ?? '');
  const [cityId, setCityId] = useState('');
  const [text, setText] = useState('');
  const [color, setColor] = useState(colors[0] ?? '');
  const [cosmetic, setCosmetic] = useState(item.needs === 'trailer_cosmetic' ? 'stripe:red' : 'grille:chrome');
  const [trailerId, setTrailerId] = useState(trailers[0]?.id ?? '');
  const [depotId, setDepotId] = useState(depots[0]?.id ?? '');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const gameUi = useFeature('game_ui');
  const [open, setOpen] = useState(false);

  const price = item.id === 'paint' && vip ? 0 : item.needs === 'vehicle_cosmetic' ? COSMETIC_PARTS[cosmetic.split(':')[0] as keyof typeof COSMETIC_PARTS].price : item.needs === 'trailer_cosmetic' ? TRAILER_COSMETIC_PARTS[cosmetic.split(':')[0] as keyof typeof TRAILER_COSMETIC_PARTS].price : item.price;
  const needsVehicle = item.needs?.startsWith('vehicle');
  const missing = (needsVehicle && !vehicleId) || (item.needs === 'vehicle_city' && !cityId) || (item.needs === 'depot_city' && (!depotId || !cityId)) || (item.needs === 'trailer_cosmetic' && !trailerId) || ((item.needs === 'vehicle_plate' || item.needs === 'username' || item.needs === 'recipient') && text.trim().length < 2);

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
          cityId: item.needs === 'vehicle_city' || item.needs === 'depot_city' ? Number(cityId) : undefined,
          depotId: item.needs === 'depot_city' ? depotId : undefined,
          plate: item.needs === 'vehicle_plate' ? text : undefined,
          color: item.needs === 'vehicle_color' ? color : undefined,
          cosmetic: item.needs === 'vehicle_cosmetic' || item.needs === 'trailer_cosmetic' ? cosmetic : undefined,
          trailerId: item.needs === 'trailer_cosmetic' ? trailerId : undefined,
          username: item.needs === 'username' ? text : undefined,
          recipient: item.needs === 'recipient' ? text : undefined,
        },
      });
      setDone(res.summary);
      if (gameUi) playCoin();
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

  const inputs = (
    <>
      {needsVehicle && (
        usable.length ? (
          <select className="input py-2 text-sm" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} aria-label={tr('Камион')}>
            {usable.map((v) => <option key={v.id} value={v.id}>{tx(v.label)}</option>)}
          </select>
        ) : (
          <p className="text-xs text-mist-400">{item.needs === 'vehicle_city' ? tr('Нямаш свободен камион.') : tr('Нямаш подходящ собствен камион.')}</p>
        )
      )}
      {item.needs === 'depot_city' && (
        depots.length ? (
          <>
            <select className="input py-2 text-sm" value={depotId} onChange={(e) => setDepotId(e.target.value)} aria-label={tr('Депо')}>
              {depots.map((d) => <option key={d.id} value={d.id}>{tx(d.label)}</option>)}
            </select>
            <select className="input py-2 text-sm" value={cityId} onChange={(e) => setCityId(e.target.value)} aria-label={tr('Нов град')}>
              <option value="">{tr('— нов град —')}</option>
              {cities.map((c) => <option key={c.id} value={c.id}>{tx(c.name)}</option>)}
            </select>
          </>
        ) : <p className="text-xs text-mist-400">{tr('Нямаш депо.')}</p>
      )}
      {item.needs === 'vehicle_city' && (
        <select className="input py-2 text-sm" value={cityId} onChange={(e) => setCityId(e.target.value)} aria-label={tr('Град')}>
          <option value="">{tr('— град —')}</option>
          {cities.map((c) => <option key={c.id} value={c.id}>{tx(c.name)}</option>)}
        </select>
      )}
      {item.needs === 'vehicle_cosmetic' && (
        <select className="input py-2 text-sm" value={cosmetic} onChange={(e) => setCosmetic(e.target.value)} aria-label={tr('Част')}>
          {COSMETIC_IDS.map((part) => (
            <optgroup key={part} label={`${tx(COSMETIC_PARTS[part].label)} · ${COSMETIC_PARTS[part].price} TC`}>
              {COSMETIC_PARTS[part].styles.map((st) => <option key={st.id} value={`${part}:${st.id}`}>{tx(COSMETIC_PARTS[part].label)}: {tx(st.label)}</option>)}
            </optgroup>
          ))}
        </select>
      )}
      {item.needs === 'trailer_cosmetic' && (
        trailers.length ? (
          <>
            <select className="input py-2 text-sm" value={trailerId} onChange={(e) => setTrailerId(e.target.value)} aria-label={tr('Ремарке')}>
              {trailers.map((t) => <option key={t.id} value={t.id}>{tx(t.label)}</option>)}
            </select>
            <select className="input py-2 text-sm" value={cosmetic} onChange={(e) => setCosmetic(e.target.value)} aria-label={tr('Част за ремаркето')}>
              {TRAILER_COSMETIC_IDS.map((part) => (
                <optgroup key={part} label={`${tx(TRAILER_COSMETIC_PARTS[part].label)} · ${TRAILER_COSMETIC_PARTS[part].price} TC`}>
                  {TRAILER_COSMETIC_PARTS[part].styles.map((st) => <option key={st.id} value={`${part}:${st.id}`}>{tx(TRAILER_COSMETIC_PARTS[part].label)}: {tx(st.label)}</option>)}
                </optgroup>
              ))}
            </select>
          </>
        ) : <p className="text-xs text-mist-400">{tr('Нямаш собствено ремарке.')}</p>
      )}
      {item.needs === 'vehicle_plate' && <input className="input py-2 text-sm uppercase" maxLength={10} value={text} onChange={(e) => setText(e.target.value.toUpperCase())} placeholder="TRANS 1" aria-label={tr('Надпис на табелата')} />}
      {item.needs === 'username' && <input className="input py-2 text-sm" maxLength={20} value={text} onChange={(e) => setText(e.target.value)} placeholder={tr('Ново потребителско име')} aria-label={tr('Ново потребителско име')} />}
      {item.needs === 'recipient' && <input className="input py-2 text-sm" maxLength={20} value={text} onChange={(e) => setText(e.target.value)} placeholder={tr('Потребителско име на играча')} aria-label={tr('Получател')} />}
      {item.needs === 'vehicle_color' && (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={tr('Цвят')}>
          {[...colors, ...vipColors].map((c) => {
            const locked = vipColors.includes(c) && !vip;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={locked ? tr('{0} (само VIP)', c) : c}
                disabled={locked}
                onClick={() => setColor(c)}
                className={`h-7 w-7 rounded-full border-2 ${color === c ? 'border-white' : 'border-asphalt-600'} ${locked ? 'opacity-30' : ''} ${vipColors.includes(c) ? 'ring-1 ring-gold-400/60' : ''}`}
                style={{ background: c }}
                title={locked ? tr('Само за VIP') : undefined}
              />
            );
          })}
        </div>
      )}
    </>
  );

  if (gameUi)
    return (
      <>
        <button className="btn-gold w-full py-2 text-sm" onClick={() => (playSelect(), setDone(null), setError(null), setOpen(true))} data-testid="shop-open">
          <Coins className="h-4 w-4" />{compact ? (price ? tr('Купи') : tr('Приложи')) : price ? tr('Купи · {0} TC', price) : tr('Приложи · безплатно (VIP)')}
        </button>
        {open && (
          <GameWindow title={tx(item.label)} icon="🛒" accent="#f6c343" size="sm" onClose={() => setOpen(false)} testId="shop-window">
            {done ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center" data-testid="shop-done">
                <div className="relative flex h-32 w-32 items-center justify-center">
                  <span aria-hidden className="fx-rays absolute inset-0 rounded-full" style={{ background: 'repeating-conic-gradient(rgba(246,195,67,0.28) 0 12deg, transparent 12deg 30deg)' }} />
                  <span className="fx-pop relative text-6xl">{EMOJI[item.id] ?? '✨'}</span>
                </div>
                <p className="fx-stamp font-display text-2xl font-bold text-gold-300">{tr('Готово!')}</p>
                <p className="text-sm text-mist-200">{done}</p>
                <button className="game-action game-action-main w-full flex-row py-3 text-sm" onClick={() => setOpen(false)}>{tr('Супер')}</button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="item-hero -mx-4 -mt-3 flex flex-col items-center px-4 pb-3 pt-5 sm:-mx-5" style={{ '--slot': '#f6c343' } as React.CSSProperties}>
                  <span className="item-hero-art text-7xl" aria-hidden>{EMOJI[item.id] ?? '🛍️'}</span>
                </div>
                <p className="text-sm text-mist-200">{tx(item.description)}</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="stat-tile rounded-2xl px-3 py-2 text-center">
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-mist-400">{tr('Цена')}</span>
                    <span className="num block text-lg font-bold text-gold-300">🪙 {price} TC</span>
                  </div>
                  <div className="stat-tile rounded-2xl px-3 py-2 text-center">
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-mist-400">{tr('Остават след това')}</span>
                    <span className={`num block text-lg font-bold ${balance < price ? 'text-loss' : 'text-white'}`}>{balance < price ? tr('липсват {0} TC', price - balance) : `${balance - price} TC`}</span>
                  </div>
                </div>
                <div className="space-y-2">{inputs}</div>
                <button className="game-action game-action-gold w-full flex-row py-3 text-sm" disabled={busy || missing || balance < price} onClick={buy} data-testid="shop-confirm">
                  {busy ? '…' : balance < price ? tr('Нужни са {0} TC', price) : price ? tr('Плати {0} TC', price) : tr('Приложи · безплатно (VIP)')}
                </button>
                {error && <p role="alert" className="text-xs text-loss">{error}</p>}
              </div>
            )}
          </GameWindow>
        )}
      </>
    );

  return (
    <div className="space-y-2">
      {inputs}
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{price ? tr('Да платиш {0} TC?', price) : tr('Потвърди (безплатно за VIP)')}</span>
          <button className="btn-gold px-3 py-1.5" onClick={buy} disabled={busy}>{busy ? '…' : tr('Потвърди')}</button>
          <button className="btn-ghost px-3 py-1.5" onClick={() => setConfirming(false)}>{tr('Отказ')}</button>
        </div>
      ) : (
        <button className="btn-gold w-full py-2 text-sm" disabled={busy || missing || balance < price} onClick={() => setConfirming(true)}>
          <Coins className="h-4 w-4" />{balance < price ? tr('Нужни са {0} TC', price) : price ? tr('Купи · {0} TC', price) : tr('Приложи · безплатно (VIP)')}
        </button>
      )}
      {error && <p role="alert" className="text-xs text-loss">{error}</p>}
      {done && <p role="status" className="text-xs text-profit">{tr('Готово: {0}', done)}</p>}
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { ITEMS, RARITIES, caseOdds, isCase, type ItemId } from '@/lib/game/items';
import { ItemArt } from './ItemArt';
import { t, tx } from '@/i18n/t';

interface Target {
  id: string;
  label: string;
}

/** 1.2: the inventory — tap an item to see it, use it or open a case. */
export function InventoryGrid({ items, drivers, vehicles }: { items: { itemId: string; qty: number }[]; drivers: Target[]; vehicles: Target[] }) {
  const router = useRouter();
  const known = items.filter((i): i is { itemId: ItemId; qty: number } => i.itemId in ITEMS);
  const [open, setOpen] = useState<ItemId | null>(known[0]?.itemId ?? null);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [won, setWon] = useState<ItemId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const def = open ? ITEMS[open] : null;
  const targets = def?.target === 'driver' ? drivers : def?.target === 'vehicle' ? vehicles : [];

  const select = (id: ItemId) => {
    setOpen(id);
    setTarget('');
    setNote(null);
    setError(null);
    setWon(null);
  };
  const run = async () => {
    if (!open) return;
    setBusy(true);
    setError(null);
    setNote(null);
    setWon(null);
    try {
      if (isCase(open)) {
        const r = await api<{ item: ItemId }>('/api/game/action', { type: 'openCase', caseId: open });
        setOpen(r.item);
        setWon(r.item);
      } else {
        const body: Record<string, unknown> = { type: 'useItem', itemId: open };
        if (def?.target === 'driver') body.driverId = target;
        if (def?.target === 'vehicle') body.vehicleId = target;
        const r = await api<{ result: string }>('/api/game/action', body);
        setNote(r.result);
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!known.length) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <ul className="grid content-start grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6">
        {known.map((i) => {
          const d = ITEMS[i.itemId];
          return (
            <li key={i.itemId}>
              <button type="button" onClick={() => select(i.itemId)} aria-pressed={open === i.itemId} className={`relative flex w-full flex-col items-center gap-1 rounded-2xl border-2 bg-asphalt-850 p-2 text-center transition hover:-translate-y-0.5 ${open === i.itemId ? 'ring-2 ring-white/40' : ''}`} style={{ borderColor: RARITIES[d.rarity].color }}>
                <ItemArt id={i.itemId} className="h-14 w-14 sm:h-16 sm:w-16" />
                <span className="line-clamp-2 text-[11px] font-medium leading-tight">{tx(d.name)}</span>
                {i.qty > 1 && <span className="num absolute right-1.5 top-1.5 rounded-full bg-asphalt-950/90 px-1.5 text-[11px] font-bold">×{i.qty}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {open && def && (
        <aside className="panel h-fit space-y-3 p-4 lg:sticky lg:top-24">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border-2 bg-asphalt-900 p-2" style={{ borderColor: RARITIES[def.rarity].color }}><ItemArt id={won ?? open} className="h-20 w-20" /></div>
            <div className="min-w-0">
              <p className="font-display text-lg font-bold">{tx(def.name)}</p>
              <p className="text-xs font-semibold" style={{ color: RARITIES[def.rarity].color }}>{tx(RARITIES[def.rarity].label)}</p>
            </div>
          </div>
          <p className="text-sm text-mist-300">{tx(def.effect)}</p>
          {isCase(open) && (
            <div>
              <p className="label mb-1">{t('Какво може да има вътре')}</p>
              <ul className="space-y-1 text-xs">
                {caseOdds(open).map((o) => (
                  <li key={o.item} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5"><ItemArt id={o.item} className="h-6 w-6" />{tx(ITEMS[o.item].name)}</span>
                    <span className="num text-mist-400">{o.percent}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {targets.length > 0 && (
            <select className="input text-sm" value={target} onChange={(e) => setTarget(e.target.value)} aria-label={def.target === 'driver' ? t('Шофьор') : t('Камион')}>
              <option value="">{def.target === 'driver' ? t('— избери шофьор —') : t('— избери камион —')}</option>
              {targets.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          )}
          {def.kind !== 'collectible' && (
            <button type="button" className="btn-primary w-full" disabled={busy || (def.target !== 'none' && !target) || !known.some((i) => i.itemId === open)} onClick={run}>
              {busy ? '…' : isCase(open) ? t('Отвори') : t('Използвай')}
            </button>
          )}
          {won && <p role="status" className="rounded-xl border border-gold-400/40 bg-gold-400/10 p-2 text-sm font-semibold text-gold-400">{t('🎉 Падна ти: {0}!', tx(ITEMS[won].name))}</p>}
          {note && <p role="status" className="text-sm text-profit">{note}</p>}
          {error && <p role="alert" className="text-sm text-loss">{error}</p>}
        </aside>
      )}
    </div>
  );
}

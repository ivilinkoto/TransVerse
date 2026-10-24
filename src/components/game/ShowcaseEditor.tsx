'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { SHOWCASE } from '@/lib/game/community';
import { t, tx } from '@/i18n/t';

type Option = { id: string; label: string };

/** Picks up to three trucks and three badges for the public profile. */
export function ShowcaseEditor({ trucks, badges, chosen }: { trucks: Option[]; badges: Option[]; chosen: { trucks: string[]; badges: string[] } }) {
  const router = useRouter();
  const [pickT, setPickT] = useState(chosen.trucks);
  const [pickB, setPickB] = useState(chosen.badges);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (list: string[], set: (l: string[]) => void, id: string, max: number) => set(list.includes(id) ? list.filter((x) => x !== id) : list.length < max ? [...list, id] : list);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', { type: 'setShowcase', trucks: pickT, badges: pickB });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const group = (title: string, options: Option[], list: string[], set: (l: string[]) => void, max: number) => (
    <fieldset className="space-y-1.5">
      <legend className="label">{title} ({tx(list.length)} / {max})</legend>
      {options.length ? (
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <label key={o.id} className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs ${list.includes(o.id) ? 'border-cyan-glow text-white' : 'border-asphalt-700 text-mist-300'}`}>
              <input type="checkbox" className="sr-only" checked={list.includes(o.id)} onChange={() => toggle(list, set, o.id, max)} />
              {tx(o.label)}
            </label>
          ))}
        </div>
      ) : <p className="text-xs text-mist-400">{t('Още нямаш.')}</p>}
    </fieldset>
  );
  return (
    <div className="space-y-3">
      {group(t('Камиони'), trucks, pickT, setPickT, SHOWCASE.trucks)}
      {group(t('Значки'), badges, pickB, setPickB, SHOWCASE.badges)}
      <button type="button" className="btn-primary py-2" onClick={save} disabled={busy}>{busy ? '…' : t('Запази витрината')}</button>
      {error && <p role="alert" className="text-xs text-loss">{error}</p>}
    </div>
  );
}

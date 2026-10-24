'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { LOGO } from '@/lib/game/company-life';
import { DesignedLogo, type LogoDesign } from './CompanyBrand';

const SHAPE_LABELS: Record<string, string> = { circle: 'Кръг', shield: 'Щит', hex: 'Шестоъгълник', diamond: 'Ромб', square: 'Квадрат' };

/** v1.9: draw a logo from a shape, two colours and up to three letters. */
export function LogoEditor({ initial, fallbackInitials }: { initial: LogoDesign | null; fallbackInitials: string }) {
  const router = useRouter();
  const [d, setD] = useState<LogoDesign>(initial ?? { shape: 'shield', color: '#1d4ed8', accent: '#f6c343', initials: fallbackInitials.slice(0, LOGO.initialsMax), stripe: false });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async (design: LogoDesign | null) => {
    setBusy(true);
    setMsg(null);
    try {
      await api('/api/game/action', { type: 'logoDesign', design });
      setMsg(design ? 'Логото е запазено.' : 'Нарисуваното лого е махнато.');
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-start gap-5">
      <DesignedLogo design={d} size={112} />
      <div className="min-w-0 flex-1 space-y-2 text-sm">
        <div className="flex flex-wrap gap-1.5">
          {LOGO.shapes.map((s) => <button key={s} type="button" onClick={() => setD({ ...d, shape: s })} className={`rounded-lg border px-2.5 py-1 text-xs ${d.shape === s ? 'border-cyan-glow text-white' : 'border-asphalt-700 text-mist-300'}`}>{SHAPE_LABELS[s]}</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5">Цвят <input type="color" value={d.color} onChange={(e) => setD({ ...d, color: e.target.value })} aria-label="Основен цвят" /></label>
          <label className="flex items-center gap-1.5">Букви <input type="color" value={d.accent} onChange={(e) => setD({ ...d, accent: e.target.value })} aria-label="Цвят на буквите" /></label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!d.stripe} onChange={(e) => setD({ ...d, stripe: e.target.checked })} />Лента</label>
        </div>
        <input className="input w-28" maxLength={LOGO.initialsMax} value={d.initials} onChange={(e) => setD({ ...d, initials: e.target.value })} aria-label="Инициали" placeholder="TV" />
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className="btn-primary" disabled={busy || !d.initials.trim()} onClick={() => void save(d)}>Запази логото</button>
          {initial && <button type="button" className="btn-ghost" disabled={busy} onClick={() => void save(null)}>Махни</button>}
        </div>
        <p className="text-xs text-mist-400">Показва се, когато компанията няма качено лого.</p>
        {msg && <p className="text-xs text-mist-300">{msg}</p>}
      </div>
    </div>
  );
}

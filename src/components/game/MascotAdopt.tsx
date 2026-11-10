'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { playCoin, playSelect } from '@/lib/client/motion';
import { MASCOT, MASCOT_KINDS, MASCOTS, type MascotKind } from '@/lib/game/mascot';
import { MascotArt } from './MascotArt';
import { t, tx } from '@/i18n/t';

/** 1.3: choosing a companion — four cards, a name, and „Вземи го“. */
export function MascotAdopt() {
  const router = useRouter();
  const [kind, setKind] = useState<MascotKind>('cat');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const adopt = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', { type: 'adoptMascot', kind, name: name || tx(MASCOTS[kind].name) });
      playCoin();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <section className="mascot-card space-y-4 rounded-3xl p-4 sm:p-5" data-testid="mascot-adopt">
      <div>
        <h2 className="font-display text-xl font-bold text-white">{t('Избери си спътник за пътя')}</h2>
        <p className="text-sm text-mist-300">{t('Расте с курсовете, радва се, когато караш, и носи малък бонус към заплащането. Всеки има любим вид курс — тогава бонусът е двоен.')}</p>
      </div>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {MASCOT_KINDS.map((k) => (
          <li key={k}>
            <button type="button" onClick={() => (playSelect(), setKind(k))} className={`mascot-pick flex h-full w-full flex-col items-center gap-1 rounded-2xl p-3 text-center ${kind === k ? 'mascot-pick-on' : ''}`} style={{ '--tile': MASCOTS[k].colour } as React.CSSProperties} data-testid={`mascot-kind-${k}`}>
              <MascotArt kind={k} className="h-24 w-24" />
              <span className="font-display font-bold text-white">{tx(MASCOTS[k].label)}</span>
              <span className="text-[11px] leading-tight text-mist-300">{t('Любим курс: {0}', tx(MASCOTS[k].favourite))}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="label">{t('Име')}</span>
          <input className="input w-full" value={name} maxLength={MASCOT.nameMax} placeholder={tx(MASCOTS[kind].name)} onChange={(e) => setName(e.target.value)} data-testid="mascot-name" />
        </label>
        <button type="button" className="game-action game-action-gold flex-row px-6 py-2.5 text-sm" disabled={busy} onClick={adopt} data-testid="mascot-adopt-go">
          {MASCOTS[kind].emoji} {t('Вземи го в кабината')}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
    </section>
  );
}

'use client';

import { Check, Loader2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { solveCaptcha, type CaptchaPuzzle } from '@/lib/captcha';
import { t } from '@/i18n/t';

export type CaptchaSolution = { id: string; number: number };

/** 1.1.2: "Не съм робот" — the browser solves a small puzzle from our own server (see src/lib/captcha.ts). */
export function Captcha({ onSolved, resetKey }: { onSolved: (s: CaptchaSolution | null) => void; resetKey: number }) {
  const [state, setState] = useState<{ key: number; status: 'idle' | 'busy' | 'done' | 'error' }>({ key: resetKey, status: 'idle' });
  // A failed sign-up uses the puzzle up: the parent bumps resetKey and the box is unticked again.
  const status = state.key === resetKey ? state.status : 'idle';

  async function start() {
    if (status === 'busy' || status === 'done') return;
    setState({ key: resetKey, status: 'busy' });
    onSolved(null);
    try {
      const res = await fetch('/api/auth/captcha', { cache: 'no-store' });
      if (!res.ok) throw new Error('captcha');
      const puzzle = (await res.json()) as CaptchaPuzzle;
      const number = await solveCaptcha(puzzle);
      if (number === null) throw new Error('captcha');
      onSolved({ id: puzzle.id, number });
      setState({ key: resetKey, status: 'done' });
    } catch {
      setState({ key: resetKey, status: 'error' });
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-asphalt-700 bg-asphalt-900/60 px-3 py-2.5">
      <button
        type="button"
        id="captcha"
        role="checkbox"
        aria-checked={status === 'done'}
        onClick={start}
        disabled={status === 'busy'}
        className="flex items-center gap-3 text-left text-sm font-medium"
      >
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${status === 'done' ? 'border-profit bg-profit/20 text-profit' : 'border-mist-400'}`}>
          {status === 'busy' ? <Loader2 className="h-4 w-4 animate-spin" /> : status === 'done' ? <Check className="h-4 w-4" /> : null}
        </span>
        <span>
          {status === 'busy' ? t('Проверка…') : t('Не съм робот')}
          {status === 'error' && <span className="block text-xs text-loss">{t('Проверката не успя. Натиснете отново.')}</span>}
        </span>
      </button>
      <span className="flex items-center gap-1 text-[11px] text-mist-400"><ShieldCheck className="h-4 w-4" />{t('Без трети страни')}</span>
    </div>
  );
}

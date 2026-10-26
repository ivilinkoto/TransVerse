'use client';

import { CheckCircle2, Loader2, PlugZap, Wrench, XCircle } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { t, tx } from '@/i18n/t';

interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

/** Checks the Discord bot live (secrets, portal settings, server, permissions, channels) and can repair commands and roles. */
export function DiscordCheck() {
  const [busy, setBusy] = useState<'check' | 'repair' | null>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const check = async () => {
    setBusy('check');
    setMessage(null);
    try {
      setChecks((await api<{ checks: Check[] }>('/api/admin/action', { type: 'checkDiscord' })).checks);
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const repair = async () => {
    setBusy('repair');
    setMessage(null);
    try {
      const r = await api<{ commands: number; players: number }>('/api/admin/action', { type: 'repairDiscord' });
      setMessage({ ok: true, text: t('Командите са записани ({0}); ролите на {1} свързани играчи се обновяват до минута.', r.commands, r.players) });
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={check} disabled={!!busy}>
          {busy === 'check' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}{t('Провери Discord')}
        </button>
        <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={repair} disabled={!!busy}>
          {busy === 'repair' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}{t('Поправи команди и роли')}
        </button>
      </div>
      {message && <p role="status" className={`mt-2 text-sm ${message.ok ? 'text-profit' : 'text-loss'}`}>{tx(message.text)}</p>}
      {checks && (
        <ul className="mt-3 divide-y divide-asphalt-800 text-sm">
          {checks.map((c) => (
            <li key={c.label} className="flex gap-2 py-2">
              {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-profit" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-loss" />}
              <div className="min-w-0">
                <div className="font-semibold">{tx(c.label)}</div>
                <div className="break-words text-xs text-mist-400">{tx(c.detail)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

'use client';

import { Flag, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api';
import { REPORT_REASONS, type ReportReason } from '@/lib/game/moderation';

export interface ReportTarget {
  targetUserId: string;
  username: string;
  kind: 'player' | 'channel' | 'company' | 'dm';
  messageId?: number;
  snippet?: string | null;
}

/** Opens the report dialog (handled by ReportHost in the game layout). */
export function openReport(target: ReportTarget) {
  window.dispatchEvent(new CustomEvent('tv:report', { detail: target }));
}

/** "Докладвай": reason and a few words; the moderators see a copy of the message. */
export function ReportHost() {
  const [target, setTarget] = useState<ReportTarget | null>(null);
  const [reason, setReason] = useState<ReportReason>('abuse');
  const [details, setDetails] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const open = (e: Event) => {
      setTarget((e as CustomEvent<ReportTarget>).detail);
      setReason((e as CustomEvent<ReportTarget>).detail.kind === 'player' ? 'name' : 'abuse');
      setDetails('');
      setState('idle');
      setError(null);
    };
    window.addEventListener('tv:report', open);
    return () => window.removeEventListener('tv:report', open);
  }, []);

  if (!target) return null;
  const send = async () => {
    setState('busy');
    setError(null);
    try {
      await api('/api/game/action', { type: 'report', report: { targetUserId: target.targetUserId, kind: target.kind, messageId: target.messageId, reason, details: details || undefined } });
      setState('done');
    } catch (e) {
      setError((e as Error).message);
      setState('idle');
    }
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Докладвай">
      <button type="button" className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-label="Затвори" onClick={() => setTarget(null)} />
      <div className="relative w-full max-w-md rounded-t-3xl border border-asphalt-700 bg-asphalt-900 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl sm:pb-5">
        <button type="button" className="absolute right-3 top-3 rounded-full p-1.5 text-mist-400 hover:bg-asphalt-800 hover:text-white" onClick={() => setTarget(null)} aria-label="Затвори"><X className="h-5 w-5" /></button>
        <h2 className="flex items-center gap-2 font-display text-lg font-bold"><Flag className="h-5 w-5 text-loss" />Докладвай {target.username}</h2>
        {state === 'done' ? (
          <div className="mt-4 space-y-3 text-sm">
            <p className="text-profit">Благодарим! Модераторите ще прегледат сигнала.</p>
            <p className="text-mist-400">Ако не искаш да виждаш съобщенията на този играч, блокирай го от картата му.</p>
            <button type="button" className="btn-ghost" onClick={() => setTarget(null)}>Затвори</button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {target.snippet && <blockquote className="whitespace-pre-wrap break-words rounded-xl border-l-2 border-amber-sig bg-asphalt-850 px-3 py-2 text-sm">{target.snippet}</blockquote>}
            <label className="block text-sm">
              <span className="label">Причина</span>
              <select className="input mt-1" value={reason} onChange={(e) => setReason(e.target.value as ReportReason)}>
                {Object.entries(REPORT_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="label">Подробности (по желание)</span>
              <textarea className="input mt-1" rows={2} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Какво се случи?" />
            </label>
            {error && <p role="alert" className="text-sm text-loss">{error}</p>}
            <button type="button" className="btn-danger w-full" disabled={state === 'busy'} onClick={() => void send()}><Flag className="h-4 w-4" />{state === 'busy' ? 'Изпращане…' : 'Изпрати сигнала'}</button>
          </div>
        )}
      </div>
    </div>
  );
}

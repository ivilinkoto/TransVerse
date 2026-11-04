'use client';

import { Lightbulb, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { t } from '@/i18n/t';

export interface LaneTipView { id: string; body: string; username: string; score: number; mine: boolean }

/** 1.2.3: the best tip for a lane, votes, and (for players who drove it) writing one. */
export function LaneTip({ tip, originCityId, destCityId, canWrite }: { tip: LaneTipView | null; originCityId: number; destCityId: number; canWrite: boolean }) {
  const router = useRouter();
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (action: Record<string, unknown>) => {
    setBusy(true); setError(null);
    try { await api('/api/game/action', action); setWriting(false); setText(''); router.refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  if (!tip && !canWrite) return null;
  return (
    <div className="mb-3 rounded-xl border border-gold-400/30 bg-gold-400/5 px-3 py-2 text-sm" data-testid="lane-tip">
      {tip ? (
        <div className="flex flex-wrap items-start gap-2">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-gold-400" />
          <p className="min-w-0 flex-1">„{tip.body}“ <span className="text-xs text-mist-400">— {tip.username} · {tip.score > 0 ? `+${tip.score}` : tip.score}</span></p>
          {!tip.mine && (
            <span className="flex gap-1">
              <button type="button" className="btn-ghost px-2 py-1" disabled={busy} onClick={() => send({ type: 'voteLaneTip', tipId: tip.id, value: 1 })} aria-label={t('Полезен съвет')}><ThumbsUp className="h-3.5 w-3.5" /></button>
              <button type="button" className="btn-ghost px-2 py-1" disabled={busy} onClick={() => send({ type: 'voteLaneTip', tipId: tip.id, value: -1 })} aria-label={t('Неполезен съвет')}><ThumbsDown className="h-3.5 w-3.5" /></button>
            </span>
          )}
          {tip.mine && <button type="button" className="text-xs text-mist-400 hover:text-white" disabled={busy} onClick={() => send({ type: 'deleteLaneTip', tipId: tip.id })}>{t('Изтрий')}</button>}
        </div>
      ) : (
        <p className="flex items-center gap-2 text-mist-300"><Lightbulb className="h-4 w-4 text-gold-400" />{t('Още няма съвет за тази линия.')}</p>
      )}
      {canWrite && (writing ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <input className="input min-w-0 flex-1 py-1.5 text-sm" maxLength={140} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Напр. „Минавай през Кулата — по-бързо е“')} aria-label={t('Съвет за линията')} />
          <button type="button" className="btn-primary px-3 py-1.5 text-sm" disabled={busy || text.trim().length < 3} onClick={() => send({ type: 'addLaneTip', originCityId, destCityId, body: text })}>{t('Запази')}</button>
        </div>
      ) : (
        <button type="button" className="mt-1 text-xs font-semibold text-cyan-glow hover:underline" onClick={() => setWriting(true)}>{tip?.mine ? t('Промени съвета си') : t('Карал си тук? Остави съвет')}</button>
      ))}
      {error && <p role="alert" className="mt-1 text-xs text-loss">{error}</p>}
    </div>
  );
}

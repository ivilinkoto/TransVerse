'use client';

import { Check, Swords, ThumbsUp, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';

/** Buttons of the v1.3 "together" pages: a duel invitation, a challenge, a livery entry and its 👍. */
function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', body);
      router.refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function DuelAnswer({ duelId }: { duelId: string }) {
  const { busy, error, run } = useAction();
  return (
    <span className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn-gold px-3 py-1.5 text-xs" disabled={busy} onClick={() => void run({ type: 'respondDuel', duelId, accept: true })}><Check className="h-3.5 w-3.5" />Приеми</button>
      <button type="button" className="btn-ghost px-3 py-1.5 text-xs" disabled={busy} onClick={() => void run({ type: 'respondDuel', duelId, accept: false })}><X className="h-3.5 w-3.5" />Откажи</button>
      {error && <span role="alert" className="text-xs text-loss">{error}</span>}
    </span>
  );
}

export function DuelChallenge({ userId, username }: { userId: string; username: string }) {
  const { busy, error, run } = useAction();
  const [sent, setSent] = useState(false);
  return (
    <>
      <button type="button" className="btn-ghost" disabled={busy || sent} onClick={() => void run({ type: 'challengeDuel', userId }).then((ok) => setSent(ok))} title={`Седмица: кой ще превози повече тонове — ти или ${username}`}>
        <Swords className="h-4 w-4" />{sent ? 'Поканата е изпратена' : 'Дуел'}
      </button>
      {error && <span role="alert" className="basis-full text-xs text-loss">{error}</span>}
    </>
  );
}

export function LiveryEnter({ trucks }: { trucks: { id: string; label: string }[] }) {
  const { busy, error, run } = useAction();
  const [vehicleId, setVehicleId] = useState(trucks[0]?.id ?? '');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="input min-w-0 flex-1" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} aria-label="Камион">
        {trucks.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
      <button type="button" className="btn-primary" disabled={busy || !vehicleId} onClick={() => void run({ type: 'enterLivery', vehicleId })}>Покажи го в конкурса</button>
      {error && <p role="alert" className="basis-full text-sm text-loss">{error}</p>}
    </div>
  );
}

export function LiveryVote({ entryId, votes, voted, own }: { entryId: string; votes: number; voted: boolean; own: boolean }) {
  const { busy, error, run } = useAction();
  return (
    <span className="flex items-center gap-2">
      <button type="button" className={`btn-ghost px-3 py-1.5 text-xs ${voted ? 'text-profit' : ''}`} disabled={busy || voted || own} onClick={() => void run({ type: 'voteLivery', entryId })} title={own ? 'Твоят камион' : voted ? 'Вече даде 👍' : 'Харесва ми'}>
        <ThumbsUp className="h-3.5 w-3.5" /><span className="num">{votes}</span>
      </button>
      {error && <span role="alert" className="text-xs text-loss">{error}</span>}
    </span>
  );
}

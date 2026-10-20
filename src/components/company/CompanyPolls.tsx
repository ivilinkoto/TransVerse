'use client';

import { BarChart3, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ActionButton } from '@/components/ui/ActionButton';
import { api } from '@/lib/client/api';
import { POLL } from '@/lib/game/polls';

export interface PollItem {
  id: string;
  question: string;
  options: string[];
  counts: number[];
  total: number;
  myVote: number | null;
  open: boolean;
  closesAt: string;
}

/** Polls in the company: the open one to vote on, the last results, and a form for ranks that run the chat. */
export function CompanyPolls({ polls, canCreate, now }: { polls: PollItem[]; canCreate: boolean; now: number }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [hours, setHours] = useState<number>(24);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = polls.find((p) => p.open);
  const past = polls.filter((p) => !p.open).slice(0, 2);

  const vote = async (pollId: string, option: number) => {
    setError(null);
    try {
      await api('/api/game/action', { type: 'votePoll', pollId, option });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', { type: 'createPoll', poll: { question, options, hours } });
      setCreating(false);
      setQuestion('');
      setOptions(['', '']);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {open && <PollCard poll={open} onVote={vote} now={now} />}
      {open && canCreate && <ActionButton action={{ type: 'closePoll', pollId: open.id }} className="btn-ghost px-3 py-1 text-xs" confirm="Да затворим ли анкетата сега?">Затвори анкетата</ActionButton>}
      {!open && canCreate && !creating && (
        <button type="button" className="btn-ghost w-full justify-center text-sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Нова анкета</button>
      )}
      {creating && (
        <form onSubmit={create} className="space-y-2 rounded-xl border border-asphalt-700 p-3">
          <input className="input w-full text-sm" maxLength={POLL.questionMax} placeholder="Въпрос (напр. Кое да строим след офиса?)" value={question} onChange={(e) => setQuestion(e.target.value)} aria-label="Въпрос" required />
          {options.map((o, i) => (
            <div key={i} className="flex gap-2">
              <input className="input min-w-0 flex-1 py-1.5 text-sm" maxLength={POLL.optionMax} placeholder={`Отговор ${i + 1}`} value={o} onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Отговор ${i + 1}`} />
              {options.length > POLL.minOptions && <button type="button" className="text-mist-400 hover:text-white" onClick={() => setOptions(options.filter((_, j) => j !== i))} aria-label="Махни отговора"><X className="h-4 w-4" /></button>}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            {options.length < POLL.maxOptions && <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => setOptions([...options, ''])}><Plus className="h-3.5 w-3.5" />Отговор</button>}
            <select className="input py-1 text-xs" value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="Продължителност">
              {POLL.hours.map((h) => <option key={h} value={h}>{h} часа</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary flex-1 justify-center text-sm" disabled={busy}>{busy ? '…' : 'Пусни анкетата'}</button>
            <button type="button" className="btn-ghost text-sm" onClick={() => setCreating(false)}>Отказ</button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="text-xs text-loss">{error}</p>}
      {past.map((p) => <PollCard key={p.id} poll={p} now={now} />)}
      {!polls.length && !canCreate && <p className="text-sm text-mist-400">Още няма анкети.</p>}
    </div>
  );
}

function PollCard({ poll, onVote, now }: { poll: PollItem; onVote?: (pollId: string, option: number) => void; now: number }) {
  const leftH = Math.max(0, Math.ceil((Date.parse(poll.closesAt) - now) / 3_600_000));
  const top = Math.max(...poll.counts);
  return (
    <div className={`rounded-xl border p-3 ${poll.open ? 'border-cyan-glow/40' : 'border-asphalt-700 opacity-80'}`}>
      <div className="flex items-start gap-2">
        <BarChart3 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-glow" />
        <div className="min-w-0 flex-1">
          <p className="break-words font-semibold">{poll.question}</p>
          <p className="text-xs text-mist-400">{poll.open ? `Отворена още ${leftH} ч · ${poll.total} ${poll.total === 1 ? 'глас' : 'гласа'}` : `Приключила · ${poll.total} ${poll.total === 1 ? 'глас' : 'гласа'}`}</p>
        </div>
      </div>
      <ul className="mt-2 space-y-1.5">
        {poll.options.map((o, i) => {
          const share = poll.total ? poll.counts[i]! / poll.total : 0;
          const mine = poll.myVote === i;
          const win = !poll.open && poll.total > 0 && poll.counts[i] === top;
          return (
            <li key={i}>
              <button
                type="button"
                disabled={!poll.open || !onVote}
                onClick={() => onVote?.(poll.id, i)}
                className={`relative w-full overflow-hidden rounded-lg border px-3 py-1.5 text-left text-sm ${mine ? 'border-cyan-glow' : 'border-asphalt-700'} ${poll.open ? 'hover:border-asphalt-500' : ''}`}
                aria-pressed={mine}
              >
                <span className="absolute inset-y-0 left-0 bg-cyan-glow/15" style={{ width: `${Math.round(share * 100)}%` }} />
                <span className="relative flex justify-between gap-2">
                  <span className={`break-words ${win ? 'font-semibold text-profit' : ''}`}>{o}{mine ? ' ✓' : ''}</span>
                  <span className="num text-xs text-mist-400">{Math.round(share * 100)} %</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

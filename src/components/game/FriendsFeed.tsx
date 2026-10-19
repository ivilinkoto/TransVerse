'use client';

import { useState } from 'react';
import { api } from '@/lib/client/api';
import { PlayerName } from './PlayerName';

export interface FeedItem {
  id: string;
  kind: string;
  text: string;
  createdAt: string;
  userId: string | null;
  username: string | null;
  company: string | null;
  cheers: number;
  cheered: boolean;
}

const ago = (iso: string, now: number) => {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (min < 60) return `преди ${min} мин`;
  if (min < 24 * 60) return `преди ${Math.round(min / 60)} ч`;
  return `преди ${Math.round(min / 1440)} дни`;
};

/** Friends and company moments with a "Браво" button (one per player; the author is told). */
export function FriendsFeed({ items, me, now }: { items: FeedItem[]; me: string; now: number }) {
  const [state, setState] = useState(() => new Map(items.map((i) => [i.id, { cheers: i.cheers, cheered: i.cheered }])));
  const [error, setError] = useState<string | null>(null);
  const bravo = async (id: string) => {
    const cur = state.get(id)!;
    if (cur.cheered) return;
    setState(new Map(state).set(id, { cheers: cur.cheers + 1, cheered: true }));
    try {
      await api('/api/game/action', { type: 'cheer', entryId: id });
    } catch (e) {
      setError((e as Error).message);
      setState((s) => new Map(s).set(id, cur));
    }
  };
  return (
    <div>
      <ul className="space-y-2.5">
        {items.map((i) => {
          const s = state.get(i.id)!;
          return (
            <li key={i.id} className="flex items-start gap-2 text-sm">
              <div className="min-w-0 flex-1">
                {i.username ? <PlayerName name={i.username} className="font-semibold" /> : <span className="font-semibold">„{i.company}“</span>} <span className="text-mist-300">{i.text}</span>
                <div className="text-[11px] text-mist-400">{ago(i.createdAt, now)}</div>
              </div>
              {i.userId !== me && (
                <button type="button" onClick={() => void bravo(i.id)} disabled={s.cheered} className={`shrink-0 rounded-full border px-2 py-0.5 text-xs transition ${s.cheered ? 'border-gold-400/50 bg-gold-400/10 text-gold-400' : 'border-asphalt-600 text-mist-300 hover:border-gold-400/60'}`} aria-label={`Браво на ${i.username ?? i.company}`}>
                  👍 {s.cheers > 0 ? s.cheers : 'Браво'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="mt-2 text-xs text-loss">{error}</p>}
    </div>
  );
}

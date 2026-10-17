'use client';

import { Check, MessageSquare, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { openDirectChat } from './PlayerCard';
import { PlayerName } from './PlayerName';

interface Friend {
  friendshipId: string;
  id: string;
  username: string;
  role: string;
  level: number;
  vip: boolean;
  online: boolean;
  lastSeen: string;
}

/** Friends with online status, and friendship requests to answer. */
export function FriendsPanel({ friends, received, sent }: { friends: Friend[]; received: Friend[]; sent: Friend[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const act = async (action: Record<string, unknown>) => {
    setBusy(true);
    try {
      await api('/api/game/action', action);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  const row = (f: Friend, actions: React.ReactNode) => (
    <li key={f.friendshipId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${f.online ? 'bg-profit' : 'bg-asphalt-500'}`} aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm">
        <PlayerName name={f.username} role={f.role} vip={f.vip} className="font-semibold" />
        <div className={`text-xs ${f.online ? 'text-profit' : 'text-mist-400'}`}>ниво {f.level} · {f.lastSeen}</div>
      </div>
      <div className="flex shrink-0 gap-1.5">{actions}</div>
    </li>
  );
  const online = friends.filter((f) => f.online).length;
  return (
    <div className="space-y-5">
      {received.length > 0 && (
        <div>
          <h3 className="label mb-2 text-gold-400">Покани за приятелство ({received.length})</h3>
          <ul className="divide-y divide-asphalt-800">
            {received.map((f) =>
              row(f, (
                <>
                  <button type="button" className="btn-gold px-3 py-1.5 text-xs" disabled={busy} onClick={() => void act({ type: 'friendRespond', friendshipId: f.friendshipId, accept: true })}><Check className="h-3.5 w-3.5" />Приеми</button>
                  <button type="button" className="btn-ghost px-2 py-1.5 text-xs" disabled={busy} onClick={() => void act({ type: 'friendRespond', friendshipId: f.friendshipId, accept: false })} aria-label="Откажи"><X className="h-3.5 w-3.5" /></button>
                </>
              )),
            )}
          </ul>
        </div>
      )}
      <div>
        <h3 className="label mb-2">Приятели · {online} онлайн от {friends.length}</h3>
        {friends.length === 0 ? (
          <p className="text-sm text-mist-400">Още нямаш приятели. Натисни името на играч — в чата, класациите или компанията — и избери „Добави приятел“.</p>
        ) : (
          <ul className="divide-y divide-asphalt-800">
            {friends.map((f) => row(f, <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => openDirectChat(f.id, f.username)}><MessageSquare className="h-3.5 w-3.5" />Пиши</button>))}
          </ul>
        )}
      </div>
      {sent.length > 0 && (
        <div>
          <h3 className="label mb-2">Изпратени покани</h3>
          <ul className="divide-y divide-asphalt-800">
            {sent.map((f) => row(f, <button type="button" className="btn-ghost px-3 py-1.5 text-xs" disabled={busy} onClick={() => void act({ type: 'friendRemove', userId: f.id })}>Отмени</button>))}
          </ul>
        </div>
      )}
    </div>
  );
}

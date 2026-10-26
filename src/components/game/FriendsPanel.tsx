'use client';

import { Building2, Check, MessageSquare, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { Avatar } from './Avatar';
import { openDirectChat } from './PlayerCard';
import { PlayerName } from './PlayerName';
import { t } from '@/i18n/t';

interface Friend {
  friendshipId: string;
  id: string;
  username: string;
  role: string;
  level: number;
  vip: boolean;
  avatarVersion: number;
  online: boolean;
  lastSeen: string;
}

/** Friends with online status, and friendship requests to answer. */
/** `invitable` (1.1.2): friends the player may invite to their company (not in one, not invited yet). */
export function FriendsPanel({ friends, received, sent, invitable = [] }: { friends: Friend[]; received: Friend[]; sent: Friend[]; invitable?: string[] }) {
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
      <span className="relative shrink-0">
        <Avatar userId={f.id} username={f.username} version={f.avatarVersion} vip={f.vip} className="h-9 w-9 text-sm" />
        <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-asphalt-900 ${f.online ? 'bg-profit' : 'bg-asphalt-500'}`} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <PlayerName name={f.username} role={f.role} vip={f.vip} className="font-semibold" />
        <div className={`text-xs ${f.online ? 'text-profit' : 'text-mist-400'}`}>{t('ниво {0} · {1}', f.level, f.lastSeen)}</div>
      </div>
      <div className="flex shrink-0 gap-1.5">{actions}</div>
    </li>
  );
  const online = friends.filter((f) => f.online).length;
  return (
    <div className="space-y-5">
      {received.length > 0 && (
        <div>
          <h3 className="label mb-2 text-gold-400">{t('Покани за приятелство ({0})', received.length)}</h3>
          <ul className="divide-y divide-asphalt-800">
            {received.map((f) =>
              row(f, (
                <>
                  <button type="button" className="btn-gold px-3 py-1.5 text-xs" disabled={busy} onClick={() => void act({ type: 'friendRespond', friendshipId: f.friendshipId, accept: true })}><Check className="h-3.5 w-3.5" />{t('Приеми')}</button>
                  <button type="button" className="btn-ghost px-2 py-1.5 text-xs" disabled={busy} onClick={() => void act({ type: 'friendRespond', friendshipId: f.friendshipId, accept: false })} aria-label={t('Откажи')}><X className="h-3.5 w-3.5" /></button>
                </>
              )),
            )}
          </ul>
        </div>
      )}
      <div>
        <h3 className="label mb-2">{t('Приятели · {0} онлайн от {1}', online, friends.length)}</h3>
        {friends.length === 0 ? (
          <p className="text-sm text-mist-400">{t('Още нямаш приятели. Натисни името на играч — в чата, класациите или компанията — и избери „Добави приятел“.')}</p>
        ) : (
          <ul className="divide-y divide-asphalt-800">
            {friends.map((f) => row(f, <>
              {invitable.includes(f.id) && <button type="button" className="btn-ghost px-3 py-1.5 text-xs" disabled={busy} onClick={() => void act({ type: 'companyInvite', userId: f.id })}><Building2 className="h-3.5 w-3.5" />{t('Покани')}</button>}
              <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => openDirectChat(f.id, f.username)}><MessageSquare className="h-3.5 w-3.5" />{t('Пиши')}</button>
            </>))}
          </ul>
        )}
      </div>
      {sent.length > 0 && (
        <div>
          <h3 className="label mb-2">{t('Изпратени покани')}</h3>
          <ul className="divide-y divide-asphalt-800">
            {sent.map((f) => row(f, <button type="button" className="btn-ghost px-3 py-1.5 text-xs" disabled={busy} onClick={() => void act({ type: 'friendRemove', userId: f.id })}>{t('Отмени')}</button>))}
          </ul>
        </div>
      )}
    </div>
  );
}

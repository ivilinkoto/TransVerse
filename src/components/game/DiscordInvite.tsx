'use client';

import { MessagesSquare, X } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { DISCORD_URL } from '@/lib/community';

/** One-time card on the dashboard: the game has a Discord server. Closing it is remembered. */
export function DiscordInvite() {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const close = () => {
    setOpen(false);
    void api('/api/game/action', { type: 'dismissHint', hint: 'discord' }).catch(() => undefined);
  };
  return (
    <div role="note" className="panel flex items-center gap-3 border-volt-500/40 p-3.5">
      <MessagesSquare className="h-6 w-6 shrink-0 text-volt-400" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">TransVerse има Discord сървър</div>
        <p className="text-sm text-mist-300">Новини за обновленията, въпроси, търсене на компания и приятели за конвой.</p>
      </div>
      <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className="btn-primary shrink-0 px-3 py-1.5 text-sm">Влез</a>
      <button type="button" onClick={close} className="self-start rounded-full p-1 text-mist-400 hover:bg-asphalt-800 hover:text-white" aria-label="Скрий"><X className="h-4 w-4" /></button>
    </div>
  );
}

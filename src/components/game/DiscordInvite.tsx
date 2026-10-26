'use client';

import { MessagesSquare, X } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { DISCORD_URL, FACEBOOK_URL } from '@/lib/community';
import { t } from '@/i18n/t';

/** One-time card on the dashboard: the game has a Discord server. Closing it is remembered. */
export function DiscordInvite() {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const close = () => {
    setOpen(false);
    void api('/api/game/action', { type: 'dismissHint', hint: 'discord' }).catch(() => undefined);
  };
  return (
    <div role="note" className="panel flex items-start gap-3 border-volt-500/40 p-3.5">
      <MessagesSquare className="mt-0.5 h-6 w-6 shrink-0 text-volt-400" />
      {/* On a phone the buttons go under the text, so the title keeps its width. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <div className="font-semibold">{t('TransVerse има Discord сървър')}</div>
          <p className="text-sm text-mist-300">{t('Новини за обновленията, въпроси, търсене на компания и приятели за конвой. Новините са и във Facebook.')}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <a href={FACEBOOK_URL} target="_blank" rel="noopener noreferrer" className="btn-ghost px-3 py-1.5 text-sm">Facebook</a>
          <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className="btn-primary px-3 py-1.5 text-sm">{t('Влез')}</a>
        </div>
      </div>
      <button type="button" onClick={close} className="shrink-0 rounded-full p-1 text-mist-400 hover:bg-asphalt-800 hover:text-white" aria-label={t('Скрий')}><X className="h-4 w-4" /></button>
    </div>
  );
}

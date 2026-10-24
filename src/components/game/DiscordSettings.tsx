'use client';

import { Link2, Unlink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ActionButton } from '@/components/ui/ActionButton';
import { api } from '@/lib/client/api';
import { t, tx } from '@/i18n/t';

const STATUS: Record<string, { text: string; good: boolean }> = {
  ok: { text: 'Discord е свързан.', good: true },
  taken: { text: 'Този Discord акаунт вече е свързан с друг профил в играта.', good: false },
  error: { text: 'Свързването не стана — опитай отново.', good: false },
  off: { text: 'Discord още не е включен в играта.', good: false },
};

/** Settings → Discord: link the account, which notifications come as Discord messages, unlink. */
export function DiscordSettings({ ready, linked, categories, prefs, status, coins }: { ready: boolean; linked: string | null; categories: Record<string, string>; prefs: Record<string, boolean | undefined>; status: string | null; coins: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = async (key: string, on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', { type: 'discordPrefs', prefs: { ...prefs, [key]: on } });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const note = status ? STATUS[status] : null;
  return (
    <div className="space-y-3 text-sm">
      {note && <p role="status" className={`rounded-xl px-3 py-2 ${note.good ? 'bg-profit/15 text-profit' : 'bg-loss/15 text-loss'}`}>{tx(note.text)}</p>}
      {!ready ? (
        <p className="text-mist-400">{t('Ботът на TransVerse в Discord още се настройва. Скоро тук ще можеш да свържеш акаунта си.')}</p>
      ) : linked ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>{t('Свързан като')}{' '}<b className="text-white">{linked}</b>{t('. В Discord сървъра имаш ролите си от играта, а командите като')}{' '}<code>{t('/профил')}</code>{' '}{t('и')}{' '}<code>{t('/камиони')}</code>{' '}{t('знаят кой си.')}</p>
            <ActionButton action={{ type: 'discordUnlink' }} className="btn-ghost text-xs" confirm={t('Да отвържем ли Discord? Ролите в сървъра ще бъдат махнати.')}><Unlink className="h-4 w-4" />{t('Отвържи')}</ActionButton>
          </div>
          <div>
            <p className="label mb-1.5">{t('Известия като лично съобщение в Discord')}</p>
            <p className="mb-2 text-xs text-mist-400">{t('Всичко е включено — махни отметката на това, което не искаш в Discord. Известията на телефона се настройват отделно по-долу.')}</p>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {Object.entries(categories).map(([key, label]) => (
                <li key={key}>
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-asphalt-700 px-2.5 py-1.5 text-xs">
                    <input type="checkbox" className="mt-0.5" checked={prefs[key] !== false} disabled={busy} onChange={(e) => void toggle(key, e.target.checked)} />
                    <span>{label}</span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[11px] text-mist-400">{t('Тихите часове важат и тук.')}</p>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-xl text-mist-300">{t('Свържи Discord и влизаш в сървъра на TransVerse с ролите си от играта (ниво, VIP, компания), канала на компанията и известия в Discord. Първия път получаваш')}{' '}<b className="text-cyan-glow">{t('{0} ТрансКоин', coins)}</b>{' '}{t('и значка „Discord шофьор“.')}</p>
          <a href="/api/discord/link" className="btn-primary"><Link2 className="h-4 w-4" />{t('Свържи Discord')}</a>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-loss">{error}</p>}
    </div>
  );
}

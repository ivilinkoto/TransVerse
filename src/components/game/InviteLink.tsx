'use client';

import { Check, Copy, Share2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { t } from '@/i18n/t';

/** The personal invite link with copy and (on phones) the system share sheet. */
export function InviteLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    void Promise.resolve().then(() => setCanShare('share' in navigator));
  }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the link stays selectable */
    }
  };
  const share = () => navigator.share?.({ title: 'TransVerse', text: t('Ела да караме камиони заедно в TransVerse — реални пътища, реални градове!'), url }).catch(() => undefined);
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className="input font-mono text-sm" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label={t('Твоят линк за покана')} />
        <div className="flex gap-2">
          <button type="button" className="btn-primary flex-1 whitespace-nowrap sm:flex-none" onClick={() => void copy()}>{copied ? <><Check className="h-4 w-4" />{t('Копирано')}</> : <><Copy className="h-4 w-4" />{t('Копирай')}</>}</button>
          {canShare && <button type="button" className="btn-ghost flex-1 sm:flex-none" onClick={() => void share()}><Share2 className="h-4 w-4" />{t('Сподели')}</button>}
        </div>
      </div>
    </div>
  );
}

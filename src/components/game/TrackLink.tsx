'use client';

import { useState } from 'react';
import { api } from '@/lib/client/api';
import { t } from '@/i18n/t';

/** 1.1.4.2 „Проследяване на живо“: a public link to this trip, to share. */
export function TrackLink({ deliveryId }: { deliveryId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const make = async () => {
    setError(null);
    try {
      const r = await api<{ token: string }>('/api/game/action', { type: 'trackLink', deliveryId });
      const link = `${window.location.origin}/track/${r.token}`;
      setUrl(link);
      try {
        await navigator.clipboard.writeText(link);
        setCopied(true);
      } catch {
        /* the link stays on screen to copy by hand */
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (url)
    return (
      <p className="mt-2 break-all text-xs text-mist-300">
        🔗 <a href={url} target="_blank" rel="noreferrer" className="text-cyan-glow hover:underline">{url}</a> {copied && <span className="text-profit">{t('копиран')}</span>}
      </p>
    );
  return (
    <span className="mt-2 inline-flex items-center gap-2">
      <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={make}>{t('🔗 Сподели на живо')}</button>
      {error && <span role="alert" className="text-xs text-loss">{error}</span>}
    </span>
  );
}

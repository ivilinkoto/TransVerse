'use client';

import { FileCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { t } from '@/i18n/t';

/** 1.1.2: accounts made before the sign-up asked for it accept the terms and the privacy policy once. */
export function TermsPrompt() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', { type: 'acceptTerms' });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const logout = async () => {
    await api('/api/auth/logout', {}).catch(() => undefined);
    router.replace('/');
    router.refresh();
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="terms-title">
      <div className="w-full max-w-md rounded-2xl border border-cyan-glow/40 bg-asphalt-900 p-5 shadow-2xl">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-cyan-glow"><FileCheck className="h-4 w-4" />{t('Общи условия')}</div>
        <h2 id="terms-title" className="mt-2 font-display text-xl font-bold">{t('Едно съгласие, само веднъж')}</h2>
        <p className="mt-2 text-sm text-mist-300">
          {t('От обновление 1.1.2 всички профили приемат общите условия и политиката за поверителност. Играта и профилът ти не се променят.')}
        </p>
        <p className="mt-2 text-sm">
          <Link href="/terms" target="_blank" className="font-semibold text-cyan-glow hover:underline">{t('Общи условия')}</Link>{' · '}
          <Link href="/privacy" target="_blank" className="font-semibold text-cyan-glow hover:underline">{t('Политика за поверителност')}</Link>
        </p>
        {error && <p role="alert" className="mt-3 text-sm text-loss">{error}</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={logout}>{t('Изход')}</button>
          <button type="button" className="btn-primary" onClick={accept} disabled={busy}>{busy ? '…' : t('Приемам')}</button>
        </div>
      </div>
    </div>
  );
}

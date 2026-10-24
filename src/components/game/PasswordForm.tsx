'use client';

import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { t, tx } from '@/i18n/t';

export function PasswordForm() {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    setBusy(true);
    setMessage(null);
    try {
      await api('/api/account/password', { current: form.get('current'), next: form.get('next') });
      setMessage({ ok: true, text: t('Паролата е сменена. Другите устройства са излезли от профила.') });
      formEl.reset();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <input id="current" name="current" type="password" className="input" placeholder={t('Текуща парола')} autoComplete="current-password" required />
      <input id="next" name="next" type="password" className="input" placeholder={t('Нова парола (поне 6 символа)')} autoComplete="new-password" required minLength={6} />
      <button className="btn-primary" disabled={busy}><KeyRound className="h-4 w-4" />{busy ? '…' : t('Смени паролата')}</button>
      {message && <p role="status" className={`text-sm ${message.ok ? 'text-profit' : 'text-loss'}`}>{tx(message.text)}</p>}
    </form>
  );
}

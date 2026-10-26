'use client';

import { AtSign, KeyRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { PasswordInput } from '@/components/auth/Field';
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
    // 1.1.2: the new password is typed twice.
    if (form.get('next') !== form.get('repeat')) return setMessage({ ok: false, text: t('Паролите не съвпадат.') });
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
      <PasswordInput id="current" name="current" placeholder={t('Текуща парола')} autoComplete="current-password" required aria-label={t('Текуща парола')} />
      <PasswordInput id="next" name="next" placeholder={t('Нова парола (поне 6 символа)')} autoComplete="new-password" required minLength={6} aria-label={t('Нова парола')} />
      <PasswordInput id="repeat" name="repeat" placeholder={t('Повтори новата парола')} autoComplete="new-password" required minLength={6} aria-label={t('Повтори новата парола')} />
      <button className="btn-primary" disabled={busy}><KeyRound className="h-4 w-4" />{busy ? '…' : t('Смени паролата')}</button>
      {message && <p role="status" className={`text-sm ${message.ok ? 'text-profit' : 'text-loss'}`}>{tx(message.text)}</p>}
    </form>
  );
}

/** 1.1.2: a new e-mail for the account (needs the password; the new address is confirmed by mail). */
export function EmailForm({ current }: { current: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    setBusy(true);
    setMessage(null);
    try {
      await api('/api/account/email', { email: form.get('email'), password: form.get('password') });
      setMessage({ ok: true, text: t('Имейлът е сменен. Изпратихме писмо за потвърждение на новия адрес.') });
      formEl.reset();
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-mist-400">{t('Сега: {0}', current)}</p>
      <input id="newEmail" name="email" type="email" className="input" placeholder={t('Нов имейл')} autoComplete="email" required aria-label={t('Нов имейл')} />
      <PasswordInput id="emailPassword" name="password" placeholder={t('Текуща парола')} autoComplete="current-password" required aria-label={t('Текуща парола')} />
      <button className="btn-primary" disabled={busy}><AtSign className="h-4 w-4" />{busy ? '…' : t('Смени имейла')}</button>
      {message && <p role="status" className={`text-sm ${message.ok ? 'text-profit' : 'text-loss'}`}>{tx(message.text)}</p>}
    </form>
  );
}

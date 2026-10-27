'use client';

import { AtSign, KeyRound, LogOut, Trash2 } from 'lucide-react';
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

/** 1.1.3: sign out every other device; this one stays signed in. */
export function SignOutOthers() {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api<{ signedOut: number }>('/api/account/sessions', {});
      setMessage({ ok: true, text: r.signedOut ? t('Излязохме от {0} други устройства.', r.signedOut) : t('Няма други влезли устройства.') });
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <p className="text-sm text-mist-400">{t('Влязъл си на чужд компютър или си загубил телефона? Това устройство остава в профила, всички други излизат.')}</p>
      <button type="button" className="btn-ghost" disabled={busy} onClick={run}><LogOut className="h-4 w-4" />{busy ? '…' : t('Излез от всички други устройства')}</button>
      {message && <p role="status" className={`text-sm ${message.ok ? 'text-profit' : 'text-loss'}`}>{tx(message.text)}</p>}
    </div>
  );
}

/** 1.1.3: delete the profile — the password and the username typed again. */
export function DeleteAccount({ username }: { username: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api('/api/account/delete', { password: form.get('password'), confirm: form.get('confirm') });
      router.replace('/');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  if (!open) return <button type="button" className="btn-ghost text-loss" onClick={() => setOpen(true)}><Trash2 className="h-4 w-4" />{t('Изтрий профила')}</button>;
  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-loss/40 bg-loss/5 p-3">
      <p className="text-sm text-mist-200">{t('Изтриването е окончателно: имейлът, името, паролата, Discord връзката, снимката и приятелствата се премахват и не можеш да влезеш отново. Парите, камионите и ТрансКоин се губят. Ако си единственият член на компания, тя се закрива; ако има други членове — първо предай собствеността.')}</p>
      <PasswordInput id="deletePassword" name="password" placeholder={t('Парола')} autoComplete="current-password" required aria-label={t('Парола')} />
      <input id="deleteConfirm" name="confirm" className="input" placeholder={t('Напиши „{0}“ за потвърждение', username)} autoComplete="off" required aria-label={t('Потребителско име')} />
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary bg-loss hover:bg-loss/90" disabled={busy}><Trash2 className="h-4 w-4" />{busy ? '…' : t('Изтрий окончателно')}</button>
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => setOpen(false)}>{t('Отказ')}</button>
      </div>
      {error && <p role="alert" className="text-sm text-loss">{tx(error)}</p>}
    </form>
  );
}

'use client';

import { CheckCircle2, KeyRound, MailCheck, Send } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { Field, Input } from './Field';
import { t } from '@/i18n/t';

const errorBox = 'rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss';

/** "Forgot password": asks for the address and always gives the same answer. */
export function ForgotPasswordForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ mailEnabled: boolean } | null>(null);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setDone(await api<{ mailEnabled: boolean }>('/api/auth/forgot', { email: new FormData(event.currentTarget).get('email') }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (done)
    return (
      <div className="space-y-4">
        <p role="status" className="flex items-start gap-2 rounded-lg border border-profit/40 bg-profit/10 px-3 py-3 text-sm text-profit">
          <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
          {done.mailEnabled ? t('Ако имейлът е регистриран, изпратихме линк за нова парола. Провери входящата поща и папката „Спам“ / „Нежелана поща“ — abv.bg и mail.bg често слагат писмата там. Линкът важи 1 час. Ако не дойде до 10 минути, пиши на поддръжката.') : t('Изпращането на имейли още не е включено. Пиши на поддръжката на играта — администратор ще ти изпрати линк за нова парола.')}
        </p>
        <Link href="/login" className="btn-ghost w-full justify-center">{t('Към входа')}</Link>
      </div>
    );
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label={t('Имейл, с който си се регистрирал')}>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      {error && <p role="alert" className={errorBox}>{error}</p>}
      <button type="submit" className="btn-primary w-full py-3" disabled={busy}><Send className="h-4 w-4" />{busy ? t('Изпращане…') : t('Изпрати линк за нова парола')}</button>
      <p className="text-center text-sm text-mist-400"><Link href="/login" className="font-semibold text-cyan-glow hover:underline">{t('Обратно към входа')}</Link></p>
    </form>
  );
}

/** Sets a new password from the e-mail link. */
export function ResetPasswordForm({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get('password') !== form.get('repeat')) return setError(t('Паролите не съвпадат.'));
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/reset', { token, password: form.get('password') });
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (done)
    return (
      <div className="space-y-4">
        <p role="status" className="flex items-center gap-2 rounded-lg border border-profit/40 bg-profit/10 px-3 py-3 text-sm text-profit"><CheckCircle2 className="h-4 w-4" />{t('Паролата е сменена. От съображения за сигурност излязохме от всички устройства.')}</p>
        <Link href="/login" className="btn-primary w-full justify-center">{t('Влез с новата парола')}</Link>
      </div>
    );
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label={t('Нова парола')} hint={t('Поне 6 символа.')}>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={6} required />
      </Field>
      <Field label={t('Повтори новата парола')}>
        <Input id="repeat" name="repeat" type="password" autoComplete="new-password" minLength={6} required />
      </Field>
      {error && <p role="alert" className={errorBox}>{error}</p>}
      <button type="submit" className="btn-primary w-full py-3" disabled={busy}><KeyRound className="h-4 w-4" />{busy ? t('Запазване…') : t('Запази новата парола')}</button>
    </form>
  );
}

/** Confirms the address with one press (e-mail scanners that open links do not use it up). */
export function VerifyEmailButton({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/verify', { token });
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (done)
    return (
      <div className="space-y-4">
        <p role="status" className="flex items-center gap-2 rounded-lg border border-profit/40 bg-profit/10 px-3 py-3 text-sm text-profit"><CheckCircle2 className="h-4 w-4" />{t('Имейлът е потвърден. Благодарим!')}</p>
        <Link href="/game" className="btn-primary w-full justify-center">{t('Към играта')}</Link>
      </div>
    );
  return (
    <div className="space-y-4">
      {error && <p role="alert" className={errorBox}>{error}</p>}
      <button type="button" onClick={confirm} className="btn-primary w-full py-3" disabled={busy}><MailCheck className="h-4 w-4" />{busy ? t('Потвърждаване…') : t('Потвърди имейла')}</button>
    </div>
  );
}

/** Banner button: send the confirmation link again. */
export function ResendVerification() {
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'off'>('idle');
  const [error, setError] = useState<string | null>(null);
  const resend = async () => {
    setState('busy');
    setError(null);
    try {
      const r = await api<{ sent: boolean }>('/api/account/verify', {});
      setState(r.sent ? 'sent' : 'off');
    } catch (e) {
      setError((e as Error).message);
      setState('idle');
    }
  };
  if (state === 'sent') return <span className="text-profit">{t('Изпратено — провери пощата си.')}</span>;
  if (state === 'off') return <span className="text-mist-400">{t('Изпращането на имейли още не е включено.')}</span>;
  return (
    <>
      <button type="button" onClick={resend} disabled={state === 'busy'} className="font-semibold text-cyan-glow hover:underline">{state === 'busy' ? t('Изпращане…') : t('Изпрати линка отново')}</button>
      {error && <span className="ml-2 text-loss">{error}</span>}
    </>
  );
}

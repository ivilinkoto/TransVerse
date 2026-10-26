'use client';

import { LogIn } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/client/api';
import { CAPTCHA } from '@/lib/captcha';
import { Captcha, type CaptchaSolution } from './Captcha';
import { Field, Input, PasswordInput } from './Field';
import { t } from '@/i18n/t';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 1.1.2: after a few wrong passwords the server asks for "Не съм робот".
  const [needCaptcha, setNeedCaptcha] = useState(false);
  const [captcha, setCaptcha] = useState<CaptchaSolution | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [failures, setFailures] = useState(0);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (needCaptcha && !captcha) return setError(t('Потвърдете, че не сте робот.'));
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/login', { login: form.get('login'), password: form.get('password'), captcha: captcha ?? undefined });
      const next = params.get('next');
      router.replace(next && next.startsWith('/game') ? next : '/game');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      const code = e instanceof ApiError ? e.code : '';
      const fails = code === 'invalid_credentials' ? failures + 1 : failures;
      setFailures(fails);
      // The server asks for it after a few wrong passwords; the form shows it right away then.
      if (code === 'captcha_required' || code === 'captcha_failed' || fails >= CAPTCHA.loginAfter) setNeedCaptcha(true);
      // A puzzle is used up by the try (and a wrong password may now need one).
      setCaptcha(null);
      setCaptchaKey((k) => k + 1);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Field label={t('Имейл или потребителско име')}>
        <Input id="login" name="login" autoComplete="username" required />
      </Field>
      <Field label={t('Парола')} hint={<Link href="/forgot-password" className="text-cyan-glow hover:underline">{t('Забравена парола?')}</Link>}>
        <PasswordInput id="password" name="password" autoComplete="current-password" required />
      </Field>
      {needCaptcha && <Captcha onSolved={setCaptcha} resetKey={captchaKey} />}
      {error && <p role="alert" className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">{error}</p>}
      <button type="submit" className="btn-primary w-full py-3" disabled={busy}>
        <LogIn className="h-4 w-4" /> {busy ? t('Влизане…') : t('Влез')}
      </button>
      <p className="text-center text-sm text-mist-400">
        {t('Нямаш акаунт?')}{' '}<Link href="/register" className="font-semibold text-cyan-glow hover:underline">{t('Регистрирай се')}</Link>
      </p>
    </form>
  );
}

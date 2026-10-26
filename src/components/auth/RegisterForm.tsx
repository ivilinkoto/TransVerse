'use client';

import { Rocket } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { Captcha, type CaptchaSolution } from './Captcha';
import { Field, Input } from './Field';
import { t, tx } from '@/i18n/t';

export function RegisterForm({ cities, referralCode = null }: { cities: { id: number; nameBg: string; population: number }[]; referralCode?: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState<CaptchaSolution | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    // 1.1.2: checked in the browser for a quick answer, and again on the server.
    if (form.password !== form.passwordConfirm) return setError(t('Паролите не съвпадат.'));
    if (!form.acceptTerms) return setError(t('Трябва да приемете общите условия и политиката за поверителност.'));
    if (!captcha) return setError(t('Потвърдете, че не сте робот.'));
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/register', { ...form, acceptTerms: true, captcha });
      router.replace('/game');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      // The puzzle is used up by the try: a new one for the next.
      setCaptcha(null);
      setCaptchaKey((k) => k + 1);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {referralCode && <input type="hidden" name="ref" value={referralCode} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('Потребителско име')}>
          <Input id="username" name="username" autoComplete="username" required minLength={3} maxLength={20} />
        </Field>
        <Field label={t('Имейл')}>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
      </div>
      <Field label={t('Парола')} hint={t('Поне 6 символа.')}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={6} />
      </Field>
      <Field label={t('Повтори паролата')}>
        <Input id="passwordConfirm" name="passwordConfirm" type="password" autoComplete="new-password" required minLength={6} />
      </Field>
      <Field label={t('Начален град')} hint={t('Реален град в България. Там те чака наетият камион.')}>
        <select id="startCityId" name="startCityId" className="input" defaultValue={cities[0]?.id}>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {tx(c.nameBg)}
            </option>
          ))}
        </select>
      </Field>
      <label className="flex items-start gap-2 text-sm text-mist-300">
        <input id="acceptTerms" name="acceptTerms" type="checkbox" required className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {t('Приемам')}{' '}<Link href="/terms" target="_blank" className="font-semibold text-cyan-glow hover:underline">{t('общите условия')}</Link>{' '}{t('и')}{' '}<Link href="/privacy" target="_blank" className="font-semibold text-cyan-glow hover:underline">{t('политиката за поверителност')}</Link>
        </span>
      </label>
      <Captcha onSolved={(s) => { setCaptcha(s); if (s) setError(null); }} resetKey={captchaKey} />
      {error && <p role="alert" className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">{error}</p>}
      <button type="submit" className="btn-primary w-full py-3" disabled={busy}>
        <Rocket className="h-4 w-4" /> {busy ? t('Създаване на профила…') : t('Започни като шофьор')}
      </button>
      <p className="text-center text-sm text-mist-400">
        {t('Вече имаш акаунт?')}{' '}<Link href="/login" className="font-semibold text-cyan-glow hover:underline">{t('Влез')}</Link>
      </p>
    </form>
  );
}

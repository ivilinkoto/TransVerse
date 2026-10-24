'use client';

import { Rocket } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { Field, Input } from './Field';
import { t, tx } from '@/i18n/t';

export function RegisterForm({ cities, referralCode = null }: { cities: { id: number; nameBg: string; population: number }[]; referralCode?: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/register', Object.fromEntries(form));
      router.replace('/game');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
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
      <Field label={t('Начален град')} hint={t('Реален град в България. Там те чака наетият камион.')}>
        <select id="startCityId" name="startCityId" className="input" defaultValue={cities[0]?.id}>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {tx(c.nameBg)}
            </option>
          ))}
        </select>
      </Field>
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

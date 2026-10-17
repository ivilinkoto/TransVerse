'use client';

import { LogIn } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { Field, Input } from './Field';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/login', { login: form.get('login'), password: form.get('password') });
      const next = params.get('next');
      router.replace(next && next.startsWith('/game') ? next : '/game');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Field label="Имейл или потребителско име">
        <Input id="login" name="login" autoComplete="username" required />
      </Field>
      <Field label="Парола" hint={<Link href="/forgot-password" className="text-cyan-glow hover:underline">Забравена парола?</Link>}>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      {error && <p role="alert" className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">{error}</p>}
      <button type="submit" className="btn-primary w-full py-3" disabled={busy}>
        <LogIn className="h-4 w-4" /> {busy ? 'Влизане…' : 'Влез'}
      </button>
      <p className="text-center text-sm text-mist-400">
        Нямаш акаунт? <Link href="/register" className="font-semibold text-cyan-glow hover:underline">Регистрирай се</Link>
      </p>
    </form>
  );
}

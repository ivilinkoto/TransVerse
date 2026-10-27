'use client';

import { AtSign, Download, KeyRound, LogOut, Monitor, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PasswordInput } from '@/components/auth/Field';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { date } from '@/lib/format';
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

/** 1.1.3: the devices signed in to the profile (with `devices`), one by one or all others at once. */
export function SignOutOthers({ devices }: { devices?: { key: string; device: string; since: string; current: boolean }[] }) {
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key?: string) => {
    setBusy(key ?? 'all');
    setMessage(null);
    try {
      const r = await api<{ signedOut: number }>('/api/account/sessions', key ? { key } : {});
      setMessage({ ok: true, text: key ? t('Устройството излезе от профила.') : r.signedOut ? t('Излязохме от {0} други устройства.', r.signedOut) : t('Няма други влезли устройства.') });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-2">
      <p className="text-sm text-mist-400">{t('Влязъл си на чужд компютър или си загубил телефона? Това устройство остава в профила, всички други излизат.')}</p>
      {devices && devices.length > 0 && (
        <ul className="divide-y divide-white/5 rounded-xl border border-asphalt-700 text-sm">
          {devices.map((d) => (
            <li key={d.key} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <Monitor className="h-4 w-4 shrink-0 text-mist-400" />
              <span className="min-w-0 flex-1"><span className="font-semibold">{tx(d.device)}</span> <span className="text-xs text-mist-400">· {t('влязъл на {0}', date(d.since))}</span></span>
              {d.current ? <span className="text-xs text-profit">{t('това устройство')}</span> : <button type="button" className="btn-ghost px-2.5 py-1 text-xs" disabled={!!busy} onClick={() => run(d.key)}>{busy === d.key ? '…' : t('Излез')}</button>}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => run()}><LogOut className="h-4 w-4" />{busy === 'all' ? '…' : t('Излез от всички други устройства')}</button>
      {message && <p role="status" className={`text-sm ${message.ok ? 'text-profit' : 'text-loss'}`}>{tx(message.text)}</p>}
    </div>
  );
}

/** 1.1.3: everything the game keeps about the player, as a file. */
export function ExportData() {
  return (
    <div className="space-y-2">
      <p className="text-sm text-mist-400">{t('Профилът, курсовете, движенията по сметката, ТрансКоин и влизанията — в един файл (JSON).')}</p>
      <a className="btn-ghost" href="/api/account/export" download><Download className="h-4 w-4" />{t('Изтегли данните си')}</a>
    </div>
  );
}

/** 1.1.3: a new username, once every 30 days (`nextAt`: when the next change is possible). */
export function UsernameForm({ current, nextAt }: { current: string; nextAt: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage(null);
    try {
      await api('/api/account/username', { username: form.get('username') });
      setMessage({ ok: true, text: t('Името е сменено.') });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  if (nextAt) return <p className="text-xs text-mist-400">{t('Следваща смяна на името: след {0}.', date(nextAt))}</p>;
  return (
    <div className="space-y-2">
      {open ? (
        <form onSubmit={submit} className="flex flex-wrap gap-2">
          <input name="username" className="input min-w-0 flex-1" defaultValue={current} minLength={3} maxLength={20} required aria-label={t('Ново потребителско име')} />
          <button className="btn-primary" disabled={busy}>{busy ? '…' : t('Запази')}</button>
          <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>{t('Отказ')}</button>
          <p className="basis-full text-xs text-mist-400">{t('Името се сменя веднъж на 30 дни. Курсовете, парите и приятелите остават.')}</p>
        </form>
      ) : <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => setOpen(true)}><Pencil className="h-3.5 w-3.5" />{t('Смени името')}</button>}
      {message && <p role="status" className={`text-sm ${message.ok ? 'text-profit' : 'text-loss'}`}>{tx(message.text)}</p>}
    </div>
  );
}

/** 1.1.3: delete the profile — the password and the username typed again; it is deleted after 7 days unless the player signs in. */
export function DeleteAccount({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ at: string }>('/api/account/delete', { password: form.get('password'), confirm: form.get('confirm') });
      setDone(date(r.at));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (done) return (
    <div role="status" className="space-y-2 rounded-xl border border-loss/40 bg-loss/5 p-3 text-sm">
      <p>{t('Излязохме от всички устройства. Профилът ще бъде изтрит на {0}. Ако размислиш, просто влез преди това.', done)}</p>
      <Link href="/" className="btn-ghost">{t('Към началото')}</Link>
    </div>
  );
  if (!open) return <button type="button" className="btn-ghost text-loss" onClick={() => setOpen(true)}><Trash2 className="h-4 w-4" />{t('Изтрий профила')}</button>;
  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-loss/40 bg-loss/5 p-3">
      <p className="text-sm text-mist-200">{t('Излизаш от всички устройства, а след 7 дни профилът се изтрива окончателно: имейлът, името, паролата, Discord връзката, снимката и приятелствата се премахват, парите, камионите и ТрансКоин се губят. Ако влезеш преди това, изтриването се отменя. Ако си единственият член на компания, тя се закрива; ако има други членове — първо предай собствеността.')}</p>
      <PasswordInput id="deletePassword" name="password" placeholder={t('Парола')} autoComplete="current-password" required aria-label={t('Парола')} />
      <input id="deleteConfirm" name="confirm" className="input" placeholder={t('Напиши „{0}“ за потвърждение', username)} autoComplete="off" required aria-label={t('Потребителско име')} />
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary bg-loss hover:bg-loss/90" disabled={busy}><Trash2 className="h-4 w-4" />{busy ? '…' : t('Изтрий профила')}</button>
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => setOpen(false)}>{t('Отказ')}</button>
      </div>
      {error && <p role="alert" className="text-sm text-loss">{tx(error)}</p>}
    </form>
  );
}

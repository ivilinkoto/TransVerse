'use client';

import { CheckCircle2, Send } from 'lucide-react';
import { useState } from 'react';
import { Captcha, type CaptchaSolution } from '@/components/auth/Captcha';
import { api } from '@/lib/client/api';
import { PARTNER_LIMITS, PARTNER_OFFERS, type PartnerKind } from '@/lib/game/partners';
import { t, tx } from '@/i18n/t';

/** 1.2.3.1: the „Пиши ни“ form of the „За партньори“ page. */
export function PartnerForm({ kind: initial, name: initialName = '', email: initialEmail = '' }: { kind?: PartnerKind; name?: string; email?: string }) {
  const [form, setForm] = useState({ kind: initial ?? ('' as PartnerKind | ''), name: initialName, email: initialEmail, organization: '', link: '', message: '', website: '' });
  const [captcha, setCaptcha] = useState<CaptchaSolution | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.kind) return setError(t('Избери за какво ни пишеш.'));
    if (!captcha) return setError(t('Потвърдете, че не сте робот.'));
    setBusy(true);
    setError(null);
    try {
      await api('/api/partners', { ...form, captcha });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
      setCaptcha(null);
      setCaptchaKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-profit/40 bg-profit/10 p-5" data-testid="partner-sent">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-profit" />
        <div>
          <div className="font-semibold">{t('Получихме съобщението ти.')}</div>
          <p className="mt-1 text-sm text-mist-300">{t('Отговаряме на {0} обикновено до 2 работни дни.', form.email)}</p>
        </div>
      </div>
    );
  }

  const field = 'input w-full';
  return (
    <form onSubmit={submit} className="space-y-4" data-testid="partner-form">
      <fieldset>
        <legend className="label mb-2">{t('За какво ни пишеш')}</legend>
        <div className="grid gap-2 sm:grid-cols-4">
          {PARTNER_OFFERS.map((o) => (
            <label key={o.kind} className={`cursor-pointer rounded-xl border px-3 py-2 text-sm ${form.kind === o.kind ? 'border-cyan-glow bg-cyan-glow/10 text-white' : 'border-asphalt-700 text-mist-300 hover:border-asphalt-600'}`}>
              <input type="radio" name="kind" value={o.kind} checked={form.kind === o.kind} onChange={set('kind')} className="sr-only" />
              {tx(o.title)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm"><span className="label">{t('Име')}</span><input className={field} value={form.name} onChange={set('name')} maxLength={PARTNER_LIMITS.name} required autoComplete="name" /></label>
        <label className="space-y-1 text-sm"><span className="label">{t('Имейл')}</span><input className={field} type="email" value={form.email} onChange={set('email')} required autoComplete="email" /></label>
        <label className="space-y-1 text-sm"><span className="label">{t('Фирма, канал или медия (по желание)')}</span><input className={field} value={form.organization} onChange={set('organization')} maxLength={PARTNER_LIMITS.org} autoComplete="organization" /></label>
        <label className="space-y-1 text-sm"><span className="label">{t('Линк (по желание)')}</span><input className={field} type="url" placeholder="https://" value={form.link} onChange={set('link')} maxLength={PARTNER_LIMITS.link} /></label>
      </div>
      {/* Bots fill in every field; people never see this one. */}
      <input type="text" name="website" value={form.website} onChange={set('website')} tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
      <label className="block space-y-1 text-sm">
        <span className="label">{t('Съобщение')}</span>
        <textarea className={`${field} min-h-32`} value={form.message} onChange={set('message')} maxLength={PARTNER_LIMITS.message} required placeholder={t('Какво предлагаш, за каква аудитория, в какви срокове…')} />
      </label>
      <Captcha onSolved={(s) => { setCaptcha(s); if (s) setError(null); }} resetKey={captchaKey} />
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
      <button type="submit" className="btn-primary" disabled={busy}><Send className="h-4 w-4" />{busy ? t('Изпращане…') : t('Изпрати')}</button>
    </form>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { CAREERS, type CareerRole } from '@/lib/game/careers';
import { t } from '@/i18n/t';

/** 1.3.1 „Екипът“: the application form (the server checks everything again). */
export function CareersForm({ roles, initial }: { roles: { id: CareerRole; label: string }[]; initial?: { role: CareerRole; about: string; hours: number; contact: string; link: string } | null }) {
  const router = useRouter();
  const [role, setRole] = useState<CareerRole>(initial?.role ?? roles[0]!.id);
  const [about, setAbout] = useState(initial?.about ?? '');
  const [hours, setHours] = useState(initial?.hours ?? 5);
  const [contact, setContact] = useState(initial?.contact ?? '');
  const [link, setLink] = useState(initial?.link ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', { type: 'applyForRole', role, about, hours, contact, link: link || undefined });
      setSent(true);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (sent) return <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-200" data-testid="careers-sent">{t('Кандидатурата е изпратена! Ще я прегледаме и ще ти пишем.')}</p>;
  const field = 'mt-1 w-full rounded-xl border border-asphalt-700 bg-asphalt-950 px-3 py-2 text-sm';
  return (
    <form onSubmit={submit} className="space-y-3" data-testid="careers-form">
      <label className="block text-sm">
        <span className="text-mist-300">{t('Позиция')}</span>
        <select id="career-role" className={field} value={role} onChange={(e) => setRole(e.target.value as CareerRole)}>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </label>
      <label className="block text-sm">
        <span className="text-mist-300">{t('Разкажи за себе си: с какво се занимаваш, какво си правил досега и защо искаш да си в екипа')}</span>
        <textarea id="career-about" className={`${field} min-h-32`} value={about} onChange={(e) => setAbout(e.target.value)} maxLength={CAREERS.aboutMax} required />
        <span className="text-xs text-mist-500">{about.length} / {CAREERS.aboutMax}</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-mist-300">{t('Часове седмично')}</span>
          <input id="career-hours" type="number" min={1} max={40} className={field} value={hours} onChange={(e) => setHours(Number(e.target.value))} required />
        </label>
        <label className="block text-sm">
          <span className="text-mist-300">{t('Discord име или друг контакт')}</span>
          <input id="career-contact" className={field} value={contact} onChange={(e) => setContact(e.target.value)} maxLength={CAREERS.contactMax} required />
        </label>
      </div>
      <label className="block text-sm">
        <span className="text-mist-300">{t('Линк към портфолио или примерна работа (по избор)')}</span>
        <input id="career-link" type="url" className={field} value={link} onChange={(e) => setLink(e.target.value)} maxLength={CAREERS.linkMax} placeholder="https://" />
      </label>
      <p className="text-xs text-mist-400">{t('Не пиши пароли, телефон или адрес. Ще се свържем с теб в Discord или в играта.')}</p>
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
      <button type="submit" className="btn-primary" disabled={busy}>{t('Изпрати кандидатурата')}</button>
    </form>
  );
}

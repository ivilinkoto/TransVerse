'use client';

import { Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { t } from '@/i18n/t';

export function NewTicketForm({ categories }: { categories: Record<string, string> }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ ok: true; id: string }>('/api/game/action', { type: 'createTicket', ticket: { subject: form.get('subject'), category: form.get('category'), body: form.get('body') } });
      router.push(`/game/support/${res.id}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <input id="subject" name="subject" className="input" placeholder={t('Тема')} required minLength={4} maxLength={120} />
      <select id="category" name="category" className="input" defaultValue="gameplay" aria-label={t('Категория')}>
        {Object.entries(categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <textarea id="body" name="body" className="input min-h-32" placeholder={t('Опишете проблема или въпроса си. Ако е грешка — какво направихте и какво се случи.')} required minLength={10} maxLength={4000} />
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
      <button className="btn-primary" disabled={busy}><Send className="h-4 w-4" />{busy ? t('Изпращане…') : t('Изпрати запитване')}</button>
    </form>
  );
}

'use client';

import { Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { t } from '@/i18n/t';

/** Reply box for a ticket thread; `endpoint` and `action` differ for players and staff. */
export function ReplyForm({ endpoint, action }: { endpoint: string; action: Record<string, unknown> }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(endpoint, { ...action, body });
      setBody('');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-2">
      <textarea id="reply" className="input min-h-28" value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('Вашият отговор…')} required maxLength={4000} aria-label={t('Отговор')} />
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
      <button className="btn-primary" disabled={busy || !body.trim()}><Send className="h-4 w-4" />{busy ? '…' : t('Изпрати')}</button>
    </form>
  );
}

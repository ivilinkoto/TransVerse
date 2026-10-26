'use client';

import { Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { t, tx } from '@/i18n/t';

/** Sends a test e-mail to any address and shows what the mail server answered. */
export function TestMailForm() {
  const router = useRouter();
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const r = await api<{ sent: boolean }>('/api/admin/action', { type: 'testMail', to });
      setResult(r.sent ? { ok: true, text: t('Сървърът прие писмото. Провери „Входящи“ и „Спам“ в тази поща.') } : { ok: false, text: t('Пощата не е настроена — нищо не е изпратено.') });
      router.refresh();
    } catch (err) {
      setResult({ ok: false, text: (err as Error).message });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void send(e)} className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className="input" type="email" required placeholder={t('напр. някой@abv.bg')} value={to} onChange={(e) => setTo(e.target.value)} aria-label={t('Адрес за проба')} />
        <button className="btn-primary whitespace-nowrap" disabled={busy || !to}><Send className="h-4 w-4" />{busy ? t('Изпращане…') : t('Изпрати проба')}</button>
      </div>
      {result && <p role="status" className={`text-sm ${result.ok ? 'text-profit' : 'text-loss'}`}>{tx(result.text)}</p>}
    </form>
  );
}

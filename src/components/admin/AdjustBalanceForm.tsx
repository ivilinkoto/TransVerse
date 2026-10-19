'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';

export function AdjustBalanceForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    setBusy(true);
    setMsg(null);
    try {
      await api('/api/admin/action', { type: 'adjustBalance', userId, amountEur: form.get('amount'), reason: form.get('reason') });
      setMsg({ ok: true, text: 'Корекцията е записана в счетоводната книга и одита.' });
      formEl.reset();
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex gap-2">
        <input id="amount" name="amount" type="number" step="0.01" className="input w-36" placeholder="± лв." required aria-label="Сума в лева" />
        <input id="reason" name="reason" className="input flex-1" placeholder="Причина (напр. компенсация за грешка)" required minLength={5} maxLength={300} aria-label="Причина" />
      </div>
      <button className="btn-ghost" disabled={busy}>{busy ? '…' : 'Запиши корекция'}</button>
      {msg && <p role="status" className={`text-sm ${msg.ok ? 'text-profit' : 'text-loss'}`}>{msg.text}</p>}
    </form>
  );
}

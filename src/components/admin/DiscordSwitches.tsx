'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';

/** Admin → Система: automatic moderation and the new members' check in the Discord server. */
export function DiscordSwitches({ automod, verification }: { automod: boolean; verification: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const set = async (key: 'automod' | 'verification', on: boolean) => {
    if (key === 'verification' && on && !confirm('Новите членове ще виждат само „Добре дошли“, докато не натиснат „Не съм бот“. Всички, които са в сървъра сега, получават ролята „✅ Проверен“. Включваме ли?')) return;
    setBusy(key);
    setMessage(null);
    try {
      const r = await api<{ ok: boolean; errors?: string[]; message?: string }>('/api/admin/action', { type: 'discordSettings', [key]: on });
      setMessage(!r.ok ? { ok: false, text: r.message ?? 'Не стана.' } : r.errors?.length ? { ok: false, text: `Направено отчасти. Discord отказа: ${r.errors.join(' · ')}` } : { ok: true, text: 'Запазено.' });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const row = (key: 'automod' | 'verification', on: boolean, title: string, text: string) => (
    <label className="flex items-start gap-3 rounded-xl border border-asphalt-700 p-3">
      <input type="checkbox" className="mt-1" checked={on} disabled={!!busy} onChange={(e) => void set(key, e.target.checked)} />
      <span>
        <span className="flex items-center gap-2 font-semibold">{title}{busy === key && <Loader2 className="h-4 w-4 animate-spin" />}</span>
        <span className="mt-0.5 block text-xs text-mist-400">{text}</span>
      </span>
    </label>
  );
  return (
    <div className="space-y-2 text-sm">
      {row('automod', automod, 'Автомодерация', 'Трие покани към други сървъри, масово споменаване, линкове от членове в първите 24 часа и спам. Първия път — лично съобщение, втория — предупреждение, после 30 минути заглушаване. Екипът не се проверява.')}
      {row('verification', verification, 'Проверка на новите членове', 'Новите виждат само „Добре дошли“, докато не натиснат „Не съм бот“ и не решат една сметка. Свързаните играчи минават сами. Каналите извън плана не се пипат.')}
      {message && <p role="status" className={message.ok ? 'text-profit' : 'text-loss'}>{message.text}</p>}
    </div>
  );
}

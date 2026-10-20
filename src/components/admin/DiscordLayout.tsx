'use client';

import { LayoutGrid, Loader2, Megaphone, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/client/api';

interface Step {
  kind: 'category' | 'channel';
  action: 'create' | 'rename' | 'move' | 'keep';
  name: string;
  from?: string;
  category?: string;
}
interface Plan {
  steps: Step[];
  others: string[];
}

const ACTION: Record<Step['action'], { text: string; cls: string }> = {
  create: { text: 'нов', cls: 'text-profit' },
  rename: { text: 'ново име', cls: 'text-amber-sig' },
  move: { text: 'премества се', cls: 'text-cyan-glow' },
  keep: { text: 'без промяна', cls: 'text-mist-400' },
};

/** Admin → Система: the plan of the server layout, then "Приложи"; the bot's panels again. */
export function DiscordLayout() {
  const [busy, setBusy] = useState<'plan' | 'apply' | 'panels' | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [perms, setPerms] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (kind: 'plan' | 'apply' | 'panels') => {
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === 'plan') {
        const r = await api<{ ok: boolean; plan?: Plan; message?: string }>('/api/admin/action', { type: 'discordLayoutPlan' });
        if (r.plan) setPlan(r.plan);
        else setMessage({ ok: false, text: r.message ?? 'Не стана.' });
      } else if (kind === 'apply') {
        const r = await api<{ ok: boolean; created?: string[]; panels?: string[]; errors?: string[]; message?: string }>('/api/admin/action', { type: 'discordLayoutApply', permissions: perms });
        const failed = r.errors ?? [];
        setMessage(!r.ok ? { ok: false, text: r.message ?? 'Не стана.' } : failed.length ? { ok: false, text: `Направено отчасти (${r.created?.length ?? 0} нови). Discord отказа: ${failed.join(' · ')}. Натисни „Покажи плана“ и „Приложи“ пак — продължава оттам.` } : { ok: true, text: `Готово: ${r.created?.length ?? 0} нови канала и категории, ${r.panels?.length ?? 0} съобщения на бота.` });
        if (r.ok && !failed.length) setPlan(null);
      } else {
        const r = await api<{ ok: boolean; panels?: string[]; message?: string }>('/api/admin/action', { type: 'discordPanels' });
        setMessage(r.ok ? { ok: true, text: `Обновени съобщения: ${r.panels?.length ?? 0}.` } : { ok: false, text: r.message ?? 'Не стана.' });
      }
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const changes = plan?.steps.filter((s) => s.action !== 'keep').length ?? 0;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => void run('plan')} disabled={!!busy}>
          {busy === 'plan' ? <Loader2 className="h-4 w-4 animate-spin" /> : <LayoutGrid className="h-4 w-4" />}Покажи плана
        </button>
        <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => void run('panels')} disabled={!!busy}>
          {busy === 'panels' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}Обнови съобщенията на бота
        </button>
      </div>
      {plan && (
        <div className="space-y-3 rounded-xl border border-asphalt-700 p-3">
          <p className="text-mist-300">{changes ? `${changes} промени.` : 'Сървърът вече е подреден.'} Нищо не се трие — каналите извън плана остават, където са.</p>
          <ul className="max-h-96 space-y-0.5 overflow-auto text-xs">
            {plan.steps.map((s, n) => (
              <li key={n} className={s.kind === 'category' ? 'pt-2 font-semibold' : 'pl-4'}>
                {s.name} <span className={ACTION[s.action].cls}>· {ACTION[s.action].text}</span>
                {s.from && <span className="text-mist-400"> (беше „{s.from}“)</span>}
              </li>
            ))}
          </ul>
          {plan.others.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-mist-300">Извън плана ({plan.others.length}) — остават; махни ги ръчно, ако не трябват</summary>
              <p className="mt-1 text-mist-400">{plan.others.join(' · ')}</p>
            </details>
          )}
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5" checked={perms} onChange={(e) => setPerms(e.target.checked)} />
            <span>Сложи правата от плана и на съществуващите канали (само за четене, екип, статистика). Без отметка правата се слагат само на новите.</span>
          </label>
          <button type="button" className="btn-primary px-3 py-1.5 text-sm" onClick={() => void run('apply')} disabled={!!busy}>
            {busy === 'apply' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}Приложи
          </button>
        </div>
      )}
      {message && <p role="status" className={message.ok ? 'text-profit' : 'text-loss'}>{message.text}</p>}
    </div>
  );
}

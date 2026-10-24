'use client';

import { LayoutGrid, Loader2, Megaphone, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { t, tx } from '@/i18n/t';

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
        else setMessage({ ok: false, text: r.message ?? t('Не стана.') });
      } else if (kind === 'apply') {
        const r = await api<{ ok: boolean; created?: string[]; panels?: string[]; errors?: string[]; message?: string }>('/api/admin/action', { type: 'discordLayoutApply', permissions: perms });
        const failed = r.errors ?? [];
        setMessage(!r.ok ? { ok: false, text: r.message ?? t('Не стана.') } : failed.length ? { ok: false, text: t('Направено отчасти ({0} нови). Discord отказа: {1}. Натисни „Покажи плана“ и „Приложи“ пак — продължава оттам.', r.created?.length ?? 0, failed.join(' · ')) } : { ok: true, text: t('Готово: {0} нови канала и категории, {1} съобщения на бота.', r.created?.length ?? 0, r.panels?.length ?? 0) });
        if (r.ok && !failed.length) setPlan(null);
      } else {
        const r = await api<{ ok: boolean; panels?: string[]; message?: string }>('/api/admin/action', { type: 'discordPanels' });
        setMessage(r.ok ? { ok: true, text: t('Обновени съобщения: {0}.', r.panels?.length ?? 0) } : { ok: false, text: r.message ?? t('Не стана.') });
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
          {busy === 'plan' ? <Loader2 className="h-4 w-4 animate-spin" /> : <LayoutGrid className="h-4 w-4" />}{t('Покажи плана')}
        </button>
        <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => void run('panels')} disabled={!!busy}>
          {busy === 'panels' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}{t('Обнови съобщенията на бота')}
        </button>
      </div>
      {plan && (
        <div className="space-y-3 rounded-xl border border-asphalt-700 p-3">
          <p className="text-mist-300">{t('{0} Нищо не се трие — каналите извън плана остават, където са.', changes ? t('{0} промени.', changes) : t('Сървърът вече е подреден.'))}</p>
          <ul className="max-h-96 space-y-0.5 overflow-auto text-xs">
            {plan.steps.map((s, n) => (
              <li key={n} className={s.kind === 'category' ? 'pt-2 font-semibold' : 'pl-4'}>
                {tx(s.name)} <span className={ACTION[s.action].cls}>· {tx(ACTION[s.action].text)}</span>
                {s.from && <span className="text-mist-400">{' '}{t('(беше „{0}“)', s.from)}</span>}
              </li>
            ))}
          </ul>
          {plan.others.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-mist-300">{t('Извън плана ({0}) — остават; махни ги ръчно, ако не трябват', plan.others.length)}</summary>
              <p className="mt-1 text-mist-400">{plan.others.join(' · ')}</p>
            </details>
          )}
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5" checked={perms} onChange={(e) => setPerms(e.target.checked)} />
            <span>{t('Сложи правата от плана и на съществуващите канали (само за четене, екип, статистика). Без отметка правата се слагат само на новите.')}</span>
          </label>
          <button type="button" className="btn-primary px-3 py-1.5 text-sm" onClick={() => void run('apply')} disabled={!!busy}>
            {busy === 'apply' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}{t('Приложи')}
          </button>
        </div>
      )}
      {message && <p role="status" className={message.ok ? 'text-profit' : 'text-loss'}>{tx(message.text)}</p>}
    </div>
  );
}

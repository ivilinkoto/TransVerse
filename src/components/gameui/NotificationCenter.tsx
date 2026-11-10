'use client';

import { useState, type ReactNode } from 'react';
import { playSelect } from '@/lib/client/motion';
import { t, tx } from '@/i18n/t';

export interface CenterTab {
  id: string;
  label: string;
  icon: string;
}

/**
 * 1.2.3.6 „Нов облик“: the notifications as a game window — tabs by kind (with how
 * many are new in each) and every notification as a card. The cards come rendered
 * from the server; the tabs only show or hide them.
 */
export function NotificationCenter({ tabs, items, initial = '' }: { tabs: CenterTab[]; initial?: string; items: { key: string; tab: string; fresh: boolean; node: ReactNode }[] }) {
  const [tab, setTab] = useState(initial);
  const shown = tab ? items.filter((i) => i.tab === tab) : items;
  const freshIn = (id: string) => items.filter((i) => i.fresh && (!id || i.tab === id)).length;
  return (
    <div className="space-y-3" data-testid="notification-center">
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label={t('Филтър')}>
        {[{ id: '', label: 'Всички', icon: '🔔' }, ...tabs].map((x) => {
          const n = freshIn(x.id);
          return (
            <button
              key={x.id || 'all'}
              type="button"
              role="tab"
              aria-selected={tab === x.id}
              onClick={() => (playSelect(), setTab(x.id))}
              className={`shop-tab relative flex shrink-0 items-center gap-1.5 rounded-2xl px-3.5 py-2 text-sm font-bold ${tab === x.id ? 'shop-tab-on' : ''}`}
            >
              <span aria-hidden>{x.icon}</span>{tx(x.label)}
              {n > 0 && <span className="num rounded-full bg-cyan-glow px-1.5 text-[10px] font-bold leading-4 text-asphalt-950">{n > 99 ? '99+' : n}</span>}
            </button>
          );
        })}
      </div>
      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-mist-400">
          <span className="text-5xl opacity-60" aria-hidden>📭</span>
          <p className="text-sm">{t('Тук няма известия.')}</p>
        </div>
      ) : (
        <ul className="space-y-2" data-testid="notification-cards">
          {shown.map((i, k) => (
            <li key={i.key} className="notif-in" style={{ animationDelay: `${Math.min(k, 12) * 30}ms` }}>{i.node}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api';
import { t } from '@/i18n/t';

/** The five places of the new menu, in order; each glows while its line is shown. */
const STEPS: { spot: string[]; title: string; text: string }[] = [
  { spot: ['nav a[href="/game"]'], title: 'Начало', text: 'Какво те чака сега — по един бутон за всяко.' },
  { spot: ['nav a[href="/game/contracts"]'], title: 'Курсове', text: 'Поръчките и картата на едно място. Оттук тръгват камионите.' },
  { spot: ['[data-testid="nav-inventory"]'], title: 'Награди', text: 'Инвентар, мисии, Truck Pass и ивенти. Числото показва какво чака да го вземеш.' },
  { spot: ['nav a[href="/game/fleet"]'], title: 'Автопарк', text: 'Камионите и шофьорите. Всеки камион има свое меню с всичко за него.' },
  { spot: ['[data-tour="more"]'], title: 'Още', text: 'Компания, Състезание, финанси, настройки и търсене „Къде е…?“.' },
];

/**
 * 1.2.2: a short tour of the new menu, once — five lines, each lighting up its
 * place in the menu. „Пропусни“ or the last „Готово“ remembers it for good.
 */
export function MenuTour() {
  const [i, setI] = useState(0);
  const [open, setOpen] = useState(true);
  const step = STEPS[i]!;
  useEffect(() => {
    if (!open) return;
    const target = step.spot.flatMap((q) => [...document.querySelectorAll(q)]).find((el) => (el as HTMLElement).offsetParent !== null) ?? null;
    target?.classList.add('tour-spot');
    return () => target?.classList.remove('tour-spot');
  }, [step, open]);
  const done = () => {
    setOpen(false);
    void api('/api/game/action', { type: 'uiPrefs', seenPage: 'nav-tour-v2' }).catch(() => {});
  };
  if (!open) return null;
  return (
    <div role="dialog" aria-label={t('Новото меню')} className="fixed inset-x-3 bottom-24 z-50 mx-auto max-w-md rounded-2xl border border-gold-400/50 bg-asphalt-900/95 p-4 shadow-2xl backdrop-blur lg:bottom-6 lg:left-[19rem] lg:right-auto lg:mx-0">
      <p className="label text-gold-300">{t('Новото меню · {0} от {1}', i + 1, STEPS.length)}</p>
      <p className="mt-1 font-display text-lg font-bold">{t(step.title)}</p>
      <p className="mt-1 text-sm text-mist-300">{t(step.text)}</p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <button type="button" className="text-xs text-mist-400 hover:text-white" onClick={done}>{t('Пропусни')}</button>
        <div className="flex gap-2">
          {i > 0 && <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setI(i - 1)}>{t('Назад')}</button>}
          {i < STEPS.length - 1 ? <button type="button" className="btn-primary px-3 py-1.5 text-sm" onClick={() => setI(i + 1)}>{t('Напред')}</button> : <button type="button" className="btn-primary px-3 py-1.5 text-sm" onClick={done}>{t('Готово')}</button>}
        </div>
      </div>
    </div>
  );
}

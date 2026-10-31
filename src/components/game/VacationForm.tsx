'use client';

import { FormAction } from '@/components/ui/FormAction';
import { ActionButton } from '@/components/ui/ActionButton';
import { t } from '@/i18n/t';

/** 1.1.4.2 „Отпуска“: start (1–14 days) or end it. */
export function VacationForm({ until }: { until: string | null }) {
  if (until)
    return (
      <div className="space-y-2 text-sm">
        <p>{t('🏖 В отпуска до {0}. Камионите почиват, заплатите и сериите чакат.', new Date(until).toLocaleString())}</p>
        <ActionButton action={{ type: 'vacation', days: 0 }} className="btn-ghost px-3 py-1.5 text-sm">{t('Прекрати отпуската')}</ActionButton>
      </div>
    );
  return (
    <div className="space-y-2">
      <p className="text-sm text-mist-300">{t('Заминаваш? Камионите на път довършват курса, нови не тръгват, заплатите не се плащат и дневната серия не се губи. До 14 дни, веднъж на 30 дни.')}</p>
      <FormAction action={{ type: 'vacation' }} fields={[{ name: 'days', label: t('Дни'), type: 'number', defaultValue: 3, min: 1, max: 14 }]} submit={t('Започни отпуска')} />
    </div>
  );
}

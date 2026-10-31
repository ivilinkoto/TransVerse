'use client';

import { FormAction } from '@/components/ui/FormAction';
import { ActionButton } from '@/components/ui/ActionButton';
import { intlLocale, t } from '@/i18n/t';

/** 1.1.4.2 „Отпуска“: start (1–14 days) or end it. */
export function VacationForm({ until }: { until: string | null }) {
  if (until)
    return (
      <div className="space-y-2 text-sm">
        <p>{t('🏖 В отпуска до {0}. Камионите почиват, заплатите и сериите чакат.', new Date(until).toLocaleString(intlLocale()))}</p>
        <ActionButton action={{ type: 'vacation', days: 0 }} className="btn-ghost px-3 py-1.5 text-sm">{t('Прекрати отпуската')}</ActionButton>
      </div>
    );
  return (
    <div className="space-y-2">
      <p className="text-sm text-mist-300">{t('Курсовете на път завършват, нови не тръгват, заплати не се плащат, серията се пази. До 14 дни, веднъж на 30.')}</p>
      <FormAction action={{ type: 'vacation' }} fields={[{ name: 'days', label: t('Дни'), type: 'number', defaultValue: 3, min: 1, max: 14 }]} submit={t('Започни отпуска')} />
    </div>
  );
}

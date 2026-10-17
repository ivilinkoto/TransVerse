export const REPORT_REASONS = {
  spam: 'Спам или реклама',
  abuse: 'Обиди или тормоз',
  cheating: 'Измама или нечестна игра',
  name: 'Неподходящо име',
  other: 'Друго',
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;

export const MUTE_OPTIONS = { h24: { label: '24 часа', ms: 86_400_000 }, d7: { label: '7 дни', ms: 7 * 86_400_000 } } as const;

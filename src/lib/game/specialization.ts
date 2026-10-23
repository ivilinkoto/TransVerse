import type { CargoType } from './cargo';

/**
 * Company specialisation (v1.6), game data: a company picks the cargo it is
 * known for; members earn a little more on those loads. It can be changed
 * once a month.
 */
export const SPECIALIZATIONS = {
  general: { label: 'Палетни товари', cargo: ['pallets'] },
  reefer: { label: 'Хладилен транспорт', cargo: ['refrigerated'] },
  bulk: { label: 'Насипни и течни', cargo: ['bulk', 'liquid'] },
  heavy: { label: 'Тежки и извънгабаритни', cargo: ['special', 'steel'] },
  logistics: { label: 'Контейнери и автовози', cargo: ['container', 'vehicles'] },
} as const satisfies Record<string, { label: string; cargo: readonly CargoType[] }>;

export type Specialization = keyof typeof SPECIALIZATIONS;

export const SPECIALIZATION = { bonusShare: 0.05, changeDays: 30 } as const;

export const specializationCovers = (spec: string | null | undefined, cargo: string) =>
  !!spec && spec in SPECIALIZATIONS && (SPECIALIZATIONS[spec as Specialization].cargo as readonly string[]).includes(cargo);

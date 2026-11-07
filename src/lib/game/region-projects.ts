/**
 * 1.2.6 „На една вълна“: a common project of the region every week — a big job
 * in one country built in stages (the goods in turn). Every delivery of the
 * stage's cargo to that country counts, whoever makes it; each finished stage
 * and the whole project give pass points (and a case at the end) to everyone who
 * helped, and the one who brought the most gets the title „Строител на региона“.
 * The progress is told in the „Проекти“ channel of the chat.
 */
import type { CargoType } from './cargo';

export const REGION_PROJECT = {
  /** Pass points for each one who helped a stage (at least `minTons` in it). */
  stagePoints: 300,
  finalPoints: 800,
  minTons: 1,
  /** The case for everyone who helped the finished project. */
  finalCase: 'case_silver' as const,
  title: 'region-builder',
  /** Lines in the „Проекти“ channel at these shares of a stage. */
  milestones: [0.5] as readonly number[],
  days: 7,
} as const;

export interface RegionStage { cargo: CargoType; tons: number; label: string }
export interface RegionTemplate { id: string; name: string; country: string; countryName: string; stages: RegionStage[] }

/** The projects, in turn (one a week). Tons are for the whole game together. */
export const REGION_PROJECTS: RegionTemplate[] = [
  { id: 'danube-bridge', name: 'Нов мост на Дунав', country: 'RO', countryName: 'Румъния', stages: [{ cargo: 'bulk', tons: 600, label: 'Насип и чакъл' }, { cargo: 'steel', tons: 400, label: 'Стоманени греди' }, { cargo: 'special', tons: 150, label: 'Кранове и машини' }] },
  { id: 'winter-reserve', name: 'Зимен резерв на България', country: 'BG', countryName: 'България', stages: [{ cargo: 'bulk', tons: 700, label: 'Пясък и сол' }, { cargo: 'liquid', tons: 400, label: 'Гориво за отопление' }, { cargo: 'pallets', tons: 300, label: 'Храни и вода' }] },
  { id: 'port-greece', name: 'Разширение на пристанище в Гърция', country: 'GR', countryName: 'Гърция', stages: [{ cargo: 'bulk', tons: 500, label: 'Бетон и камък' }, { cargo: 'container', tons: 500, label: 'Контейнери с оборудване' }, { cargo: 'steel', tons: 300, label: 'Кейови конструкции' }] },
  { id: 'serbia-hospital', name: 'Нова болница в Сърбия', country: 'RS', countryName: 'Сърбия', stages: [{ cargo: 'steel', tons: 350, label: 'Конструкция' }, { cargo: 'pallets', tons: 400, label: 'Обзавеждане' }, { cargo: 'refrigerated', tons: 150, label: 'Лекарства' }] },
  { id: 'turkey-market', name: 'Голям пазар в Турция', country: 'TR', countryName: 'Турция', stages: [{ cargo: 'steel', tons: 300, label: 'Халета' }, { cargo: 'refrigerated', tons: 400, label: 'Плодове и зеленчуци' }, { cargo: 'pallets', tons: 400, label: 'Стоки за щандовете' }] },
];

/** The project of a week (weeks counted from a Monday). */
export function regionTemplateFor(weekStart: Date): RegionTemplate {
  const n = Math.floor(weekStart.getTime() / (7 * 86_400_000));
  return REGION_PROJECTS[((n % REGION_PROJECTS.length) + REGION_PROJECTS.length) % REGION_PROJECTS.length]!;
}

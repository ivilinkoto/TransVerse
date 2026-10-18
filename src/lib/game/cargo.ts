/**
 * Cargo categories and the body types able to carry them.
 * Pure game data — shared by server and UI.
 */

export const BODY_TYPES = ['box', 'curtain', 'reefer', 'tipper', 'tanker', 'container', 'lowbed', 'flatbed', 'car_carrier'] as const;
export type BodyType = (typeof BODY_TYPES)[number];

export const CARGO_TYPES = ['pallets', 'refrigerated', 'bulk', 'container', 'liquid', 'special', 'steel', 'vehicles'] as const;
export type CargoType = (typeof CARGO_TYPES)[number];

export interface CargoDefinition {
  id: CargoType;
  label: string;
  /** Body types that may legally carry this cargo. */
  bodies: BodyType[];
  /** €/km base plus €/(t·km), both in euro cents. */
  baseCentsPerKm: number;
  centsPerTonKm: number;
  /** Player level needed to see/accept. */
  minLevel: number;
  /** Example goods, used for flavour on contracts. */
  goods: string[];
  /** Typical consignment weight bounds in tonnes. */
  tons: [number, number];
}

export const CARGO: Record<CargoType, CargoDefinition> = {
  pallets: {
    id: 'pallets',
    label: 'Палетизирани товари',
    bodies: ['box', 'curtain'],
    baseCentsPerKm: 60,
    centsPerTonKm: 4.5,
    minLevel: 1,
    goods: ['Мебели', 'Авточасти', 'Битова техника', 'Опаковки', 'Текстил', 'Строителна химия', 'Напитки'],
    tons: [0.4, 24],
  },
  refrigerated: {
    id: 'refrigerated',
    label: 'Хладилни стоки',
    bodies: ['reefer'],
    baseCentsPerKm: 70,
    centsPerTonKm: 5.5,
    minLevel: 2,
    goods: ['Плодове и зеленчуци', 'Млечни продукти', 'Замразено месо', 'Лекарства', 'Цветя'],
    tons: [0.5, 22],
  },
  bulk: {
    id: 'bulk',
    label: 'Насипни материали',
    bodies: ['tipper'],
    baseCentsPerKm: 55,
    centsPerTonKm: 3.6,
    minLevel: 3,
    goods: ['Зърно', 'Пясък', 'Чакъл', 'Торове', 'Слънчоглед'],
    tons: [14, 26],
  },
  container: {
    id: 'container',
    label: 'Контейнери',
    bodies: ['container'],
    baseCentsPerKm: 65,
    centsPerTonKm: 4.2,
    minLevel: 4,
    goods: ['40-футов контейнер', '20-футов контейнер', 'Хладилен контейнер'],
    tons: [8, 26],
  },
  liquid: {
    id: 'liquid',
    label: 'Течни товари',
    bodies: ['tanker'],
    baseCentsPerKm: 75,
    centsPerTonKm: 5.2,
    minLevel: 5,
    goods: ['Дизелово гориво', 'Олио', 'Мляко', 'Химикали', 'Вода за индустрията'],
    tons: [16, 25],
  },
  special: {
    id: 'special',
    label: 'Специализирани товари',
    bodies: ['lowbed'],
    baseCentsPerKm: 120,
    centsPerTonKm: 6.5,
    minLevel: 7,
    goods: ['Строителна машина', 'Трансформатор', 'Селскостопанска техника', 'Индустриална преса'],
    tons: [18, 40],
  },
  steel: {
    id: 'steel',
    label: 'Метали и дървен материал',
    bodies: ['flatbed'],
    baseCentsPerKm: 62,
    centsPerTonKm: 4.4,
    minLevel: 3,
    goods: ['Стоманени рулони', 'Арматура', 'Стоманени греди', 'Обли трупи', 'Дъски и греди', 'Ламарина'],
    tons: [10, 26],
  },
  vehicles: {
    id: 'vehicles',
    label: 'Нови автомобили',
    bodies: ['car_carrier'],
    baseCentsPerKm: 95,
    centsPerTonKm: 3.5,
    minLevel: 4,
    goods: ['Нови леки автомобили', 'Микробуси', 'Употребявани автомобили за търговец', 'Електромобили'],
    tons: [6, 16],
  },
};

export function canCarry(bodies: readonly BodyType[], cargo: CargoType): boolean {
  return CARGO[cargo].bodies.some((b) => bodies.includes(b));
}

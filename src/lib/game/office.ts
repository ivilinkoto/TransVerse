/**
 * 1.1.4.2 „Офис“: people in the office next to the drivers. One per role, up
 * to level 3; each has a salary and a character. Game data (invented names).
 */
export const OFFICE_ROLES = {
  dispatcher: { label: 'Диспечер', emoji: '🎧', effect: '+1 място в опашката на ниво' },
  accountant: { label: 'Счетоводител', emoji: '🧮', effect: '−2% разходи по курса на ниво' },
  sales: { label: 'Търговец', emoji: '🤝', effect: '+2% към плащането на ниво' },
  inspector: { label: 'Механик-инспектор', emoji: '🛠', effect: '−10% износване на ниво' },
} as const;
export type OfficeRole = keyof typeof OFFICE_ROLES;
export const OFFICE_ROLE_IDS = Object.keys(OFFICE_ROLES) as OfficeRole[];
export const OFFICE_MAX_LEVEL = 3;

export const OFFICE_TRAITS = [
  { id: 'pedant', label: 'Педант', line: 'Всичко е подредено по папки.' },
  { id: 'cheerful', label: 'Весел', line: 'Носи баница всеки петък.' },
  { id: 'night_owl', label: 'Нощна птица', line: 'Най-бодър е след полунощ.' },
  { id: 'old_school', label: 'Старата школа', line: 'Помни всяка отбивка от 90-те.' },
  { id: 'gadget', label: 'Техноманиак', line: 'Има приложение за всичко.' },
] as const;

const FIRST = ['Мария', 'Иван', 'Елена', 'Георги', 'Десислава', 'Николай', 'Анелия', 'Петър', 'Силвия', 'Христо'];
const LAST = ['Петрова', 'Колев', 'Димитрова', 'Стоянов', 'Николова', 'Ангелов', 'Тодорова', 'Маринов', 'Илиева', 'Василев'];

/** A name and character for a new hire (from any random source). */
export function officeHire(rand: () => number) {
  const i = Math.floor(rand() * FIRST.length);
  // The surname list is paired by gender with the first names.
  const name = `${FIRST[i]} ${LAST[i % 2 === 0 ? (Math.floor(rand() * 5) * 2) : (Math.floor(rand() * 5) * 2 + 1)]}`;
  return { name, trait: OFFICE_TRAITS[Math.floor(rand() * OFFICE_TRAITS.length)]!.id };
}

export const officeSalaryCents = (level: number) => (90 + level * 35) * 100;
/** Training to the next level: this many days of the new salary. */
export const officeTrainCents = (nextLevel: number) => officeSalaryCents(nextLevel) * 5 * nextLevel;

export function officeEffect(role: OfficeRole, level: number): number {
  const l = Math.min(OFFICE_MAX_LEVEL, Math.max(0, level));
  return { dispatcher: l, accountant: 0.02 * l, sales: 0.02 * l, inspector: 0.1 * l }[role];
}

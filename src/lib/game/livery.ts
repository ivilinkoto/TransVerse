/** Company liveries (v1.3): the colours a company can paint its members' trucks in. */
export const LIVERY_COLORS = [
  { id: '#1d4ed8', label: 'Кралско синьо' },
  { id: '#0e7490', label: 'Петролено' },
  { id: '#047857', label: 'Горско зелено' },
  { id: '#65a30d', label: 'Лайм' },
  { id: '#ca8a04', label: 'Горчица' },
  { id: '#ea580c', label: 'Оранжево' },
  { id: '#b91c1c', label: 'Червено' },
  { id: '#7c3aed', label: 'Виолетово' },
  { id: '#0f172a', label: 'Графит' },
  { id: '#e5e7eb', label: 'Бяло' },
] as const;
export type LiveryColor = (typeof LIVERY_COLORS)[number]['id'];
export const isLiveryColor = (c: string): c is LiveryColor => LIVERY_COLORS.some((l) => l.id === c);

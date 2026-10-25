import { sofiaParts } from './missions';

/**
 * Eras (v2.0 "Светът се отваря"), game data: every month the game lives in
 * one of four eras, in turn. Each era favours a way of trucking with a
 * small bonus on the loads that fit it.
 */
export type EraId = 'retro' | 'industrial' | 'highway' | 'green';

export interface Era {
  id: EraId;
  label: string;
  icon: string;
  body: string;
  share: number;
}

export const ERAS: readonly Era[] = [
  { id: 'retro', label: 'Ретро ера', icon: '📻', body: 'Камионите с ретро боя (70-те, 80-те, 90-те) получават +5 % на всеки товар.', share: 0.05 },
  { id: 'industrial', label: 'Индустриална ера', icon: '🏭', body: 'Насипните товари, стоманата и контейнерите плащат +5 %.', share: 0.05 },
  { id: 'highway', label: 'Ерата на магистралите', icon: '🛣️', body: 'Курсовете над 800 км плащат +5 %.', share: 0.05 },
  { id: 'green', label: 'Зелена ера', icon: '🔋', body: 'Електрическите камиони получават +8 % на всеки товар.', share: 0.08 },
];

const ROTATION_START = { y: 2027, m: 9 };

/** The era of a month (Sofia time): the four in turn from September 2027. */
export function eraAt(now: Date): Era {
  const { y, m } = sofiaParts(now);
  const i = (((y - ROTATION_START.y) * 12 + (m - ROTATION_START.m)) % ERAS.length + ERAS.length) % ERAS.length;
  return ERAS[i]!;
}

/** The era after the current one. */
export function nextEra(now: Date): Era {
  const i = ERAS.indexOf(eraAt(now));
  return ERAS[(i + 1) % ERAS.length]!;
}

/** Whether a load fits the era. */
export function eraFits(era: Era, load: { livery: string | null; electric: boolean; cargo: string; km: number }): boolean {
  switch (era.id) {
    case 'retro':
      return !!load.livery && load.livery.startsWith('retro');
    case 'industrial':
      return load.cargo === 'bulk' || load.cargo === 'steel' || load.cargo === 'container';
    case 'highway':
      return load.km > 800;
    case 'green':
      return load.electric;
  }
}

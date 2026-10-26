import { ECONOMY } from './economy';

/**
 * 1.1.2: why a truck that is not on a trip cannot take any load, and where
 * the player fixes it. Mirrors the per-load checks of `compatibilityError`
 * that block every load at once (the board would otherwise just be empty).
 */
export interface TruckBlock {
  vehicleId: string;
  /** Bulgarian text key: what stops the truck. */
  reason: string;
  /** Where the player fixes it, and the button text. */
  href: string;
  action: string;
}

interface TruckLike {
  id: string;
  status: string;
  condition: number;
  model: { kind: string };
  trailer: { condition: number } | null;
  driver: { vacationUntil?: Date | null } | null;
  delivery: unknown;
}

export function truckBlock(v: TruckLike, now: Date): TruckBlock | null {
  if (v.delivery) return null;
  const block = (reason: string, href: string, action: string) => ({ vehicleId: v.id, reason, href, action });
  if (v.status === 'listed') return block('Обявен е за продажба — докато обявата стои, не кара.', '/game/garage', 'Към обявата');
  if (v.status !== 'idle') return null;
  if (!v.driver) return block('Няма назначен шофьор.', '/game/staff', 'Назначи шофьор');
  if (v.driver.vacationUntil && v.driver.vacationUntil > now) return block('Шофьорът е в почивен ден.', '/game/staff', 'Към шофьорите');
  if (v.model.kind === 'tractor' && !v.trailer) return block('Влекачът няма прикачено ремарке.', '/game/fleet', 'Прикачи ремарке');
  if (v.condition < ECONOMY.minConditionForJobs) return block('В лошо състояние е — нужен е ремонт.', '/game/garage', 'Към сервиза');
  if (v.trailer && v.trailer.condition < ECONOMY.minConditionForJobs) return block('Ремаркето е в лошо състояние — нужен е ремонт.', '/game/garage', 'Към сервиза');
  return null;
}

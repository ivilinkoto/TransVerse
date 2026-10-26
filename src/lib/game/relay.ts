import { t } from '@/i18n/t';
/**
 * Щафета (v1.10): a long load in two legs. The first driver takes it from
 * A to a relay city half-way; there it waits (6 hours) for a second driver,
 * who takes it on to B. Each leg is paid by its own kilometres (a little
 * over the board); when both legs arrive on time with two different
 * players, each gets +10 % of their leg and the "Щафета" badge.
 */
export const RELAY = {
  minKm: 600,
  maxKm: 1400,
  open: 4,
  ttlHours: 8,
  handoverHours: 6,
  multiplier: 1.15,
  bonusShare: 0.1,
  badge: 'relay',
} as const;

export const relayLabel = (leg: number | null | undefined) => (leg === 1 ? t('ЩАФЕТА 1/2') : leg === 2 ? t('ЩАФЕТА 2/2') : null);

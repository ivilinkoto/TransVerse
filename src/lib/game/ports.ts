/**
 * Ports (v1.4): the big real container ports of the region send containers
 * inland, and now and then a ship call ("Кораб пристига") brings dozens of
 * them at once — the companies race to haul the most. Ship names, sizes and
 * prizes are game data.
 */

/** GeoNames ids of the container ports (city of the terminal). */
export const CONTAINER_PORTS = [
  { cityId: 2911298, name: 'Хамбург' },
  { cityId: 2944368, name: 'Бремерхафен' },
  { cityId: 2844588, name: 'Росток' },
  { cityId: 680963, name: 'Кюстенджа' },
  { cityId: 726050, name: 'Варна' },
  { cityId: 732770, name: 'Бургас' },
  { cityId: 255274, name: 'Пирея' },
  { cityId: 734077, name: 'Солун' },
  { cityId: 742394, name: 'Истанбул (Амбарлъ)' },
  { cityId: 311046, name: 'Измир' },
  { cityId: 304531, name: 'Мерсин' },
] as const;

export const PORT_LOADS = {
  /** Open port loads kept at each port. */
  perPort: 3,
  /** Pay on top of an ordinary container load. */
  multiplier: 1.1,
  minKm: 80,
  maxKm: 900,
  ttlHours: 18,
} as const;

export const SHIP_CALL = {
  /** Containers a ship brings. */
  containers: [18, 36] as const,
  hours: 48,
  /** A new ship after the last one ended, at the earliest. */
  pauseHours: 30,
  /** Between these hours (Sofia) a ship comes in. */
  fromHour: 9,
  toHour: 19,
  /** Pay on top of an ordinary container load. */
  multiplier: 1.3,
  /** The company that hauled the most (at least `minContainers`) gets this into its treasury. */
  prizeCents: 25_000_00,
  minContainers: 3,
} as const;

/** Fictional ship names. */
export const SHIP_NAMES = ['MV Балкан Стар', 'MV Дунавска звезда', 'MV Aegean Spirit', 'MV Северен вятър', 'MV Черноморец', 'MV Hanse Trader', 'MV Anatolia Bridge', 'MV Тракия', 'MV Морска пролет', 'MV Euxinus'];

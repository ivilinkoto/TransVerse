/**
 * "Икономичен шофьор": a weekly ranking by the lowest running cost per km —
 * fuel, tolls, maintenance and road incidents of the player's own trips
 * (rented trucks do not count: the lessor pays their costs). At least
 * `minKm` in the week to rank. The top three get money and ТрансКоин.
 */
export const ECO = {
  minKm: 1_500,
  categories: ['fuel', 'tolls', 'maintenance', 'road_events'] as string[],
  prizes: [
    { cents: 5_000_00, coins: 30 },
    { cents: 3_000_00, coins: 20 },
    { cents: 1_500_00, coins: 10 },
  ],
} as const;

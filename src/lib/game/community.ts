/**
 * Together on the road in v1.5 (game data):
 * - The perfect convoy: both trucks of a convoy arrive on time and within a
 *   few minutes of each other — an extra bonus for each and a post in Discord.
 * - Lane records: the fastest loaded run on each lane in a month.
 * - The company staff bus: a new member's truck goes to the company base in a
 *   minute, free, once; the first trip as a member pays a bonus.
 * - The company anniversary: every year since the founding, a gift into the
 *   treasury and a badge for the members.
 * - The profile showcase: three trucks and three badges on the public profile.
 * - The alliance warehouse: members of an alliance sell goods from their
 *   warehouses to each other in the same city.
 */
export const PERFECT_CONVOY = {
  /** Both arrivals within this many minutes of each other (real time). */
  togetherMin: 10,
  /** Extra share of each reward, on top of the convoy bonus. */
  bonusShare: 0.05,
} as const;

/** Both on time and close together: the convoy was perfect. */
export function isPerfectConvoy(a: { late: boolean; at: number }, b: { late: boolean; at: number }) {
  return !a.late && !b.late && Math.abs(a.at - b.at) <= PERFECT_CONVOY.togetherMin * 60_000;
}

export const LANE_RECORDS = {
  /** Only loaded runs at least this long count (short hops are not records). */
  minKm: 50,
} as const;

/** The month of a record, e.g. "2027-02" (Sofia). */
export function recordMonth(at: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit' }).format(at).slice(0, 7);
}

/** Minutes of a loaded run, from the end of loading to arrival. */
export function loadedRunMinutes(segments: readonly { kind: string; leg: string; start: number; end: number }[]) {
  const loaded = segments.filter((s) => s.leg === 'loaded' && s.kind !== 'loading');
  if (!loaded.length) return null;
  return Math.max(1, Math.round((loaded.at(-1)!.end - loaded[0]!.start) / 60_000));
}

export const STAFF_BUS = {
  /** The bus can be used within this many days of joining. */
  days: 14,
  /** The ride to the base takes a minute (as the move to a depot). */
  rideMs: 60_000,
  /** The first trip as a member: this share of the reward on top. */
  firstTripShare: 0.1,
} as const;

export const ANNIVERSARY = {
  /** Gift per year of the company, into the treasury. */
  perYearCents: 5_000_00,
  maxCents: 50_000_00,
  badge: 'anniversary',
} as const;

export const anniversaryGiftCents = (years: number) => Math.min(ANNIVERSARY.maxCents, years * ANNIVERSARY.perYearCents);

/** Full years since the founding on this day (Sofia), or 0 when today is not the anniversary. */
export function anniversaryYears(foundedAt: Date, now: Date) {
  const day = (t: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
  const [fy, fmd] = [day(foundedAt).slice(0, 4), day(foundedAt).slice(5)];
  const [ny, nmd] = [day(now).slice(0, 4), day(now).slice(5)];
  // Founded on 29 February: the anniversary is on 28 February in other years.
  const same = nmd === fmd || (fmd === '02-29' && nmd === '02-28' && !isLeap(Number(ny)));
  const years = Number(ny) - Number(fy);
  return same && years > 0 ? years : 0;
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Days until the next anniversary (0 = today). */
export function daysToAnniversary(foundedAt: Date, now: Date) {
  for (let i = 0; i <= 366; i++) if (anniversaryYears(foundedAt, new Date(now.getTime() + i * 86_400_000))) return i;
  return 366;
}

export const SHOWCASE = { trucks: 3, badges: 3 } as const;

/** "Шофьор на месеца" in a company: the member with the most trips (at least this many), prizes the owner may set. */
export const DRIVER_OF_MONTH = { minTrips: 3, badge: 'driver-of-month', prizes: [0, 500_00, 1_000_00, 2_000_00, 5_000_00] as const } as const;

export const ALLIANCE_MARKET = {
  /** A listing waits this long; then the goods go back to the seller's warehouse. */
  hours: 72,
  /** Price per tonne: a share of what the goods cost from the producers in that city. */
  minPriceShare: 0.5,
  maxPriceShare: 1.5,
  maxListings: 5,
} as const;

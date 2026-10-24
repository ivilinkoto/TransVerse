import { t as tr } from '@/i18n/t';
/**
 * Сенчести товари (v1.9) — the smuggling side of the game, as a choice:
 * two reputations, the honest one (the company's reputation) and the
 * underground one. Only harmless goods (fake-brand clothes, undeclared
 * electronics, cheese without papers); no weapons, drugs or people.
 *
 * Opt-in in settings from level 10. Offers come in the evening, are
 * personal (never on the public board), cross a border and pay ×2–3.
 * At each border customs may check the truck: the chance grows with the
 * heat ("Внимание") and police reports on the way, and falls with a
 * hidden compartment and a trusted contact in the start city. Caught:
 * the load is confiscated (no pay) and a fine is taken — never below 0.
 * Game money only (never ТрансКоин); rented trucks cannot carry it.
 */

export const SMUGGLING = {
  minLevel: 10,
  /** Sofia time when offers appear (from–to, hours). */
  eveningFrom: 18,
  eveningTo: 24,
  offers: 3,
  offerTtlHours: 3,
  /** Pay over an ordinary load of the same lane. */
  multiplier: { min: 2, max: 3 },
  tons: { min: 2, max: 8 },
  /** Heat ("Внимание") 0–100. */
  heatMax: 100,
  heatPerRun: 12,
  heatHonestDrop: 2,
  heatDailyDrop: 5,
  heatReportDrop: 15,
  heatCaught: 25,
  /** Chance of a check at one border. */
  baseCheck: 0.06,
  heatCheck: 0.004,
  policeCheck: 0.05,
  policeCap: 0.15,
  compartmentFactor: 0.5,
  contactCheck: 0.015,
  checkCap: 0.6,
  /** A check with no border on the way (a spot check inside the country). */
  domesticCheck: 0.02,
  /** Fine: a share of the load's pay. */
  fineShare: 0.6,
  /** Underground reputation. */
  undergroundRun: 5,
  undergroundCaught: -8,
  undergroundReport: -10,
  /** Reporting a shady offer to customs: honest reputation (up to N a day). */
  reportReputation: 1,
  reportsPerDay: 3,
  /** A contact in a city: runs from it raise its level (up to 3). */
  contactRunsPerLevel: 3,
  contactMaxLevel: 3,
  contactPay: 0.05,
  /** The hidden compartment: bought on the black market, takes payload. */
  compartmentPriceCents: 6_500_00,
  compartmentPayloadTons: 2,
  /** Black-market repair: cheaper, but it is noticed. */
  blackRepairShare: 0.6,
  blackRepairHeat: 5,
} as const;

export const UNDERGROUND_TIERS = [
  { min: 0, name: 'Непознат', perk: 'Само най-простите пратки.' },
  { min: 30, name: 'Познат', perk: 'По-скъпи пратки (до ×2,5) и тайно отделение на черния пазар.' },
  { min: 100, name: 'Доверен', perk: 'Пратки до ×3 и евтин ремонт на черния пазар.' },
  { min: 250, name: 'Легенда на сенките', perk: 'Най-добрите оферти и още една пратка вечер.' },
] as const;

export function undergroundTier(points: number) {
  let tier = 0;
  UNDERGROUND_TIERS.forEach((t, i) => {
    if (points >= t.min) tier = i;
  });
  return { tier, ...UNDERGROUND_TIERS[tier]! };
}

/** The best multiplier a tier gets (offers are drawn up to it). */
export const tierMultiplier = (tier: number) => [2.2, 2.5, 3, 3][tier] ?? 2.2;

export const SHADY_GOODS = [
  'Дрехи с измислени „маркови“ етикети',
  'Недекларирана електроника',
  'Сирене без документи',
  'Кашкавал без сертификат',
  'Парфюми „почти оригинал“',
  'Резервни части без фактура',
  'Слънчеви очила без етикети',
  'Билкови чайове без етикет',
  'Мед от „неизвестна“ пчела',
  'Маратонки с три и половина ивици',
] as const;

export const isEvening = (sofiaHour: number) => sofiaHour >= SMUGGLING.eveningFrom && sofiaHour < SMUGGLING.eveningTo;

export const clampHeat = (heat: number) => Math.max(0, Math.min(SMUGGLING.heatMax, Math.round(heat)));

export const contactLevel = (runs: number) => Math.min(SMUGGLING.contactMaxLevel, 1 + Math.floor(runs / SMUGGLING.contactRunsPerLevel));

/** Chance that one border check finds the load. */
export function borderCheckChance(o: { heat: number; policeReports: number; compartment: boolean; contactLevel: number }) {
  const police = Math.min(SMUGGLING.policeCap, o.policeReports * SMUGGLING.policeCheck);
  const raw = (SMUGGLING.baseCheck + o.heat * SMUGGLING.heatCheck + police) * (o.compartment ? SMUGGLING.compartmentFactor : 1) - o.contactLevel * SMUGGLING.contactCheck;
  return Math.max(0.01, Math.min(SMUGGLING.checkCap, raw));
}

/** Chance that the whole run is caught (each border is a check). */
export function runCatchChance(borders: number, perBorder: number) {
  if (borders <= 0) return SMUGGLING.domesticCheck;
  return 1 - (1 - perBorder) ** borders;
}

/** The fine when caught: never more than the player has (money cannot go below 0). */
export const fineCents = (rewardCents: number, balanceCents: number) => Math.max(0, Math.min(Math.round(rewardCents * SMUGGLING.fineShare), balanceCents));

/** The heat as words. */
export function heatLabel(heat: number) {
  if (heat >= 70) return { label: tr('Висока'), tone: 'red' as const };
  if (heat >= 35) return { label: tr('Средна'), tone: 'gold' as const };
  return { label: tr('Ниска'), tone: 'green' as const };
}

/** A company's status on its profile: clean, or grey when its members run shady loads. */
export const companyShade = (members: { underground: number }[]) => (members.reduce((s, m) => s + m.underground, 0) >= 100 ? 'grey' : 'clean');

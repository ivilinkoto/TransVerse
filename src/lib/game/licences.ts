/**
 * Carrier licences a player buys once and keeps. Pure rules shared by server and UI.
 *
 * The truck licences gate real contracts today. Rail, air, coastal and ocean
 * licences belong to transport modes the game does not have yet; they are listed
 * as "coming soon" and cannot be bought, so nobody pays for something that does
 * nothing.
 */
import type { CargoType } from './cargo';

export const LICENCE_IDS = ['international', 'customs', 'adr', 'reefer', 'oversize', 'rail', 'air', 'coastal', 'ocean'] as const;
export type LicenceId = (typeof LICENCE_IDS)[number];

export interface LicenceDefinition {
  id: LicenceId;
  label: string;
  short: string;
  description: string;
  priceCents: number;
  minLevel: number;
  /** Another licence the player must already hold. */
  requires?: LicenceId;
  /** False for modes that are not in the game yet. */
  available: boolean;
}

export const LICENCES: Record<LicenceId, LicenceDefinition> = {
  international: {
    id: 'international',
    label: 'Международен лиценз',
    short: 'Международен',
    description: 'Курсове, при които товарът пресича граница между две държави.',
    priceCents: 3_000_00,
    minLevel: 2,
    available: true,
  },
  customs: {
    id: 'customs',
    label: 'Митнически лиценз (TIR)',
    short: 'Митнически',
    description: 'Курсове през външната граница на ЕС — до и от Турция, Сърбия и Северна Македония.',
    priceCents: 5_000_00,
    minLevel: 3,
    requires: 'international',
    available: true,
  },
  reefer: {
    id: 'reefer',
    label: 'Хладилен лиценз (ATP)',
    short: 'Хладилен',
    description: 'Превоз на хладилни стоки при контролирана температура.',
    priceCents: 2_500_00,
    minLevel: 2,
    available: true,
  },
  adr: {
    id: 'adr',
    label: 'ADR — опасни товари',
    short: 'ADR',
    description: 'Течни и опасни товари: горива, химикали и други цистерни.',
    priceCents: 6_000_00,
    minLevel: 4,
    available: true,
  },
  oversize: {
    id: 'oversize',
    label: 'Извънгабаритни товари',
    short: 'Извънгабаритен',
    description: 'Тежки и извънгабаритни товари на нискорамни ремаркета.',
    priceCents: 9_000_00,
    minLevel: 6,
    available: true,
  },
  rail: { id: 'rail', label: 'ЖП лиценз', short: 'ЖП', description: 'Железопътен превоз на товари.', priceCents: 15_000_00, minLevel: 8, available: false },
  air: { id: 'air', label: 'Въздушен карго лиценз', short: 'Въздушен', description: 'Въздушен превоз на товари.', priceCents: 25_000_00, minLevel: 10, available: false },
  coastal: { id: 'coastal', label: 'Крайбрежен лиценз', short: 'Крайбрежен', description: 'Морски превоз между пристанища по крайбрежието.', priceCents: 18_000_00, minLevel: 9, available: false },
  ocean: { id: 'ocean', label: 'Океански лиценз', short: 'Океански', description: 'Океански превоз на контейнери.', priceCents: 30_000_00, minLevel: 12, requires: 'coastal', available: false },
};

/** Countries in the game that are outside the EU (crossing into them needs customs clearance). */
export const NON_EU = new Set(['TR', 'RS', 'MK', 'CH', 'BA', 'ME', 'AL', 'XK', 'MD', 'UA', 'BY', 'RU', 'GE', 'AM']);

const CARGO_LICENCE: Partial<Record<CargoType, LicenceId>> = { refrigerated: 'reefer', liquid: 'adr', special: 'oversize' };

/** Licences a contract needs: by cargo, and by the countries the loaded route passes. */
export function requiredLicences(cargo: string, countries: readonly string[]): LicenceId[] {
  const needed: LicenceId[] = [];
  const set = new Set(countries);
  if (set.size > 1) {
    needed.push('international');
    if ([...set].some((c) => NON_EU.has(c))) needed.push('customs');
  }
  const byCargo = CARGO_LICENCE[cargo as CargoType];
  if (byCargo) needed.push(byCargo);
  return needed;
}

export function missingLicences(needed: readonly LicenceId[], held: ReadonlySet<string>): LicenceId[] {
  return needed.filter((l) => !held.has(l));
}

/** Countries of a contract for licence checks: the route's countries plus both ends. */
export function contractCountries(originCountry: string, destCountry: string, routeCountries: readonly string[] | null | undefined): string[] {
  return [...new Set([originCountry, destCountry, ...(routeCountries ?? [])])];
}

/** Companies pay double; in exchange every member may use the licence. */
export const COMPANY_LICENCE_MULTIPLIER = 2;
export const companyLicencePrice = (id: LicenceId) => LICENCES[id].priceCents * COMPANY_LICENCE_MULTIPLIER;

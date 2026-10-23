/**
 * Countries in the game. The data model is global; these lists control which
 * part of the real world is imported and playable.
 */
export const LAUNCH_COUNTRIES = ['BG', 'RO', 'GR', 'TR', 'RS', 'MK', 'HU', 'AT', 'DE'] as const;
export type LaunchCountry = (typeof LAUNCH_COUNTRIES)[number];

/** "Цяла Европа" (v1.7): playable from the release, for the staff before it. */
export const EUROPE_COUNTRIES = ['PL', 'CZ', 'SK', 'SI', 'HR', 'BA', 'ME', 'AL', 'XK', 'IT', 'FR', 'ES', 'PT', 'NL', 'BE', 'LU', 'CH'] as const;

/** Everything imported into the game (the dataset). */
export const GAME_COUNTRIES = [...LAUNCH_COUNTRIES, ...EUROPE_COUNTRIES] as const;
export type GameCountry = (typeof GAME_COUNTRIES)[number];

const europe = new Set<string>(EUROPE_COUNTRIES);
export const isEuropeCountry = (code: string | null | undefined) => !!code && europe.has(code);

/** The countries a player can drive in now (Europe: from v1.7, the staff earlier). */
export const playableCountries = (europe: boolean): readonly string[] => (europe ? GAME_COUNTRIES : LAUNCH_COUNTRIES);

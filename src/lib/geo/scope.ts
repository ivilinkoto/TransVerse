/**
 * Countries in the launch region. The data model is global; this list only
 * controls which part of the real world is imported and playable first.
 */
export const LAUNCH_COUNTRIES = ['BG', 'RO', 'GR', 'TR', 'RS', 'MK', 'HU', 'AT', 'DE'] as const;
export type LaunchCountry = (typeof LAUNCH_COUNTRIES)[number];

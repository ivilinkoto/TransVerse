/**
 * 1.1.4.2 „Развойна дейност“: the company invests money and real time in its
 * technologies. Each has three levels; a level takes hours to research and
 * one technology is researched at a time. Game data.
 */
export const TECHS = {
  aero: { label: 'Аеродинамичен пакет', emoji: '💨', effect: '−3% гориво на ниво (връща се при доставка)', perLevel: 0.03 },
  telematics: { label: 'Телематика', emoji: '📡', effect: '+2% за навреме на ниво', perLevel: 0.02 },
  smart_loading: { label: 'Умно товарене', emoji: '📦', effect: '+1% към бонуса от товаренето на ниво', perLevel: 0.01 },
  predictive: { label: 'Предсказваща поддръжка', emoji: '🔧', effect: '−10% износване на ниво', perLevel: 0.1 },
} as const;
export type TechId = keyof typeof TECHS;
export const TECH_IDS = Object.keys(TECHS) as TechId[];
export const MAX_TECH_LEVEL = 3;

/** Price (stotinki) and real hours of the next level (1-based). */
export function techCost(level: number): { cents: number; hours: number } {
  return { cents: [0, 25_000_00, 60_000_00, 140_000_00][level] ?? 0, hours: [0, 6, 18, 48][level] ?? 0 };
}

/** The effect of the reached levels (a share: 0.03 = 3%). */
export const techEffect = (tech: TechId, level: number) => TECHS[tech].perLevel * Math.min(MAX_TECH_LEVEL, Math.max(0, level));

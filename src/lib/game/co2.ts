/**
 * 1.1.4.2 „CO₂ квоти“: each company gets a weekly emission quota per truck.
 * Diesel burns 2.64 kg CO₂ a litre (the real factor); electric trucks emit
 * nothing on the road. Unused quota becomes credits to sell to other players
 * or to the market; going over is paid at the market price on Monday.
 * Prices and quota are game data.
 */
export const CO2 = {
  kgPerLitre: 2.64,
  /** Weekly quota per truck (kg). */
  quotaKgPerTruck: 9000,
  /** The market buys credits at this price and sells the missing tonnes at that one (stotinki per tonne). */
  marketBuyCents: 60_00,
  marketSellCents: 95_00,
  /** Player listings must be between these prices. */
  minPriceCents: 40_00,
  maxPriceCents: 200_00,
};

export const co2KgOf = (litres: number) => Math.round(litres * CO2.kgPerLitre * 10) / 10;
export const quotaKg = (trucks: number) => Math.max(1, trucks) * CO2.quotaKgPerTruck;

/** The week's result: credits earned (t) or tonnes over (t). */
export function co2Week(kg: number, quota: number) {
  const diff = (quota - kg) / 1000;
  return diff >= 0 ? { creditsT: Math.floor(diff * 10) / 10, overT: 0 } : { creditsT: 0, overT: Math.ceil(-diff * 10) / 10 };
}

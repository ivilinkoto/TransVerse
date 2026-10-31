import { seededRandom } from './road-events';

/**
 * 1.1.4.2 „Реклама по ремаркето“: fictional brands pay to have their advert
 * driven around. Each offer asks for kilometres in a country within a week
 * (some count only trips on time). The brands are invented. Game data.
 */
export const AD_BRANDS = [
  { id: 'zlato', name: 'Олио „Злато“', color: '#eab308' },
  { id: 'izvor', name: 'Вода „Планински извор“', color: '#38bdf8' },
  { id: 'zvezda', name: 'Кафе „Утринна звезда“', color: '#a16207' },
  { id: 'patnik', name: 'Гуми „Пътник“', color: '#475569' },
  { id: 'dab', name: 'Мебели „Дъб и бор“', color: '#65a30d' },
  { id: 'lale', name: 'Шоколад „Лале“', color: '#db2777' },
  { id: 'most', name: 'Банка „Мост“', color: '#2563eb' },
  { id: 'iskra', name: 'Енергия „Искра“', color: '#f97316' },
] as const;

export const ADS = {
  offers: 3,
  maxActive: 2,
  days: 7,
  /** Pay per required km (stotinki); trips on time only pay more. */
  centsPerKm: 55,
  onTimeFactor: 1.35,
  countries: ['BG', 'RO', 'GR', 'RS', 'TR', 'MK', 'HU', 'AT', 'DE', 'IT', 'PL', 'CZ'],
};

export interface AdOffer {
  key: string;
  brand: string;
  color: string;
  country: string;
  targetKm: number;
  rule: 'any' | 'on_time';
  payCents: number;
}

/** The week's offers for a company (the same all week). */
export function adOffers(week: string, companyId: string, countries: readonly string[] = ADS.countries): AdOffer[] {
  const rand = seededRandom(`ads:${week}:${companyId}`);
  const brands = [...AD_BRANDS].sort(() => rand() - 0.5).slice(0, ADS.offers);
  return brands.map((b, i) => {
    const country = countries[Math.floor(rand() * countries.length)] ?? 'BG';
    const targetKm = Math.round((1200 + rand() * 2800) / 100) * 100;
    const rule = rand() < 0.4 ? 'on_time' : 'any';
    return { key: `${week}:${i}`, brand: b.name, color: b.color, country, targetKm, rule, payCents: Math.round(targetKm * ADS.centsPerKm * (rule === 'on_time' ? ADS.onTimeFactor : 1)) };
  });
}

export const brandColor = (name: string) => AD_BRANDS.find((b) => b.name === name)?.color ?? '#64748b';

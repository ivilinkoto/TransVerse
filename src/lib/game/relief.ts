/**
 * Humanitarian convoys (v1.8), a game event: every three weeks a country of
 * the game needs help (the cause is the game's, not real news). For two days
 * relief loads go there from cities around it, and the whole community
 * counts the deliveries into the country. Each relief load on time brings
 * ТрансКоин and reputation; the first one the badge "Хуманитарен конвой".
 */
export const RELIEF = {
  everyDays: 21,
  hours: 48,
  openLoads: 6,
  maxKm: 1_200,
  multiplier: 1.2,
  tons: [4, 12] as [number, number],
  coins: 3,
  reputation: 1,
  badge: 'humanitarian',
  target: 30,
  rewards: { participant: { cents: 1_000_00, xp: 300, coins: 10 } },
  causes: ['наводнение', 'обилен снеговалеж', 'горски пожари', 'силна буря', 'свлачища'],
  goods: ['Хуманитарна помощ: вода и храна', 'Хуманитарна помощ: одеяла и палатки', 'Хуманитарна помощ: лекарства', 'Хуманитарна помощ: генератори', 'Хуманитарна помощ: строителни материали'],
} as const;

/**
 * 1.1.4.2 „Интервю“: after a big success the press asks for a word. The answer
 * matters for a week: modest — trust (reputation); bold — bigger pay, stricter
 * clients; the team — the drivers are prouder. Game data.
 */
export const INTERVIEW_OCCASIONS = {
  big_run: 'Голям рейс за седмицата',
  perfect: 'Десет перфектни курса подред',
  mystery: 'Пет звезди от тайния клиент',
  challenge: 'Победа в предизвикателство',
} as const;
export type InterviewOccasion = keyof typeof INTERVIEW_OCCASIONS;

export const INTERVIEW_ANSWERS = {
  modest: { label: 'Скромен', quote: '„Просто си вършим работата.“', effect: '+2 репутация' },
  bold: { label: 'Самоуверен', quote: '„Ние сме най-добрите на пътя.“', effect: '7 дни: +5% за курс навреме, но двойна неустойка' },
  team: { label: 'Екипът', quote: '„Всичко е заслуга на шофьорите ми.“', effect: '+5 лоялност за всички шофьори' },
} as const;
export type InterviewAnswer = keyof typeof INTERVIEW_ANSWERS;

export const INTERVIEW = { days: 7, boldShare: 0.05, modestReputation: 2, teamLoyalty: 5, /** at most one open interview a week */ cooldownDays: 7 };

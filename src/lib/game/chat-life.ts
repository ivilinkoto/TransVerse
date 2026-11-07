/**
 * 1.2.6 „На една вълна“: reasons to talk in the game's chat — lines from the game
 * (moments), a question every evening and a thank-you from new players to the
 * ones who help them. The rewards are pass points, not ТрансКоин.
 */
export const CHAT_LIFE = {
  /** The author of the game's lines in the chat. */
  botName: 'TransVerse',
  botEmail: 'bot@transverse.invalid',
  /** At most one moment in the global chat this often (the chat stays a chat). */
  momentGapMinutes: 10,
  /** The question of the day: Sofia hour, how long answers count, how many are rewarded and with what. */
  questionHour: 19,
  questionHours: 4,
  questionRewarded: 10,
  questionPoints: 250,
  /** A new player (up to this level) can thank whoever answered them. */
  newbieLevel: 5,
  thankPoints: 200,
  /** Thanks a helper can get a day (and each answer only once). */
  thanksPerDay: 3,
} as const;

/** The questions of the day, in turn (one a day). */
export const DAILY_QUESTIONS: string[] = [
  'Кой е най-трудният път, който сте карали в играта?',
  'Кой камион е любимият ви и защо?',
  'Сол, пясък или луга — с какво разчиствате пътищата?',
  'Кой град е най-добрият за депо?',
  'Каква поръчка бихте поели веднага, ако я видите на борсата?',
  'Самостоятелно или в компания — как ви е по-интересно?',
  'Кой е най-дългият ви курс досега?',
  'Какво бихте добавили в играта, ако зависеше от вас?',
  'Нощем или денем карате повече?',
  'Зимни гуми или риск — какво избирате?',
  'Коя държава е най-изгодна за товари?',
  'Кой предмет от кейсовете искате най-много?',
  'Кой съвет бихте дали на нов шофьор?',
  'Имате ли любима линия, която карате пак и пак?',
];

/** The question for a Sofia day (YYYY-MM-DD), the same for everyone. */
export function questionFor(day: string): string {
  const n = Math.floor(new Date(`${day}T12:00:00Z`).getTime() / 86_400_000);
  return DAILY_QUESTIONS[n % DAILY_QUESTIONS.length]!;
}

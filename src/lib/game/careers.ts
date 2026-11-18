/**
 * 1.3.1 „Екипът“: TransVerse looks for volunteers. The open roles, what they do, what they get
 * (no pay yet: the game has no income) and how we choose — on the „Кариери“ page in the account
 * menu, where a player of 16 or older applies. No window opens by itself. The admins read the
 * applications (Админ → Кандидатури).
 */
export type CareerRole = 'lead' | 'tester' | 'moderator' | 'community' | 'designer';

export interface CareerRoleDef { id: CareerRole; label: string; emoji: string; hours: string; does: string[]; fits: string; open: boolean; /** Shown on the page, but chosen by the founder: no form. */ invite?: boolean }

export const CAREER_ROLES: CareerRoleDef[] = [
  {
    // The founder keeps the code, the server, the money and the last word on releases; the lead runs the rest.
    id: 'lead', label: 'Ръководител на играта', emoji: '🧭', hours: '6–10 ч седмично', open: false, invite: true,
    does: ['Отговаря за играта като цяло: поддръжка, общност и Discord', 'Намира и води екипа, води седмичната среща', 'Взема решенията за играта и екипа и е единствената връзка с основателя'],
    fits: 'Пълнолетен, организиран и спокоен. Избираме го сред хората, които вече познаваме — по покана, без формуляр.',
  },
  {
    id: 'tester', label: 'Тестер на обновленията', emoji: '🧪', hours: '2–4 ч седмично', open: true,
    does: ['Пробва новите функции преди всички — на телефон и компютър', 'Описва ясно какво не работи и как да се повтори', 'Казва кое е объркващо за нов играч'],
    fits: 'Внимателен си към детайлите и играеш редовно. Не е нужен опит.',
  },
  {
    id: 'moderator', label: 'Модератор и поддръжка', emoji: '🛡️', hours: '3–5 ч седмично', open: true,
    does: ['Отговаря на въпросите в играта и в Discord', 'Пази реда в чата и разглежда докладите', 'Събира бъговете и ги предава на екипа'],
    fits: 'Спокоен и учтив си, познаваш играта и си тук редовно. Не е нужен опит.',
  },
  {
    id: 'community', label: 'Общност и съдържание', emoji: '📣', hours: '3–6 ч седмично', open: true,
    does: ['Обявленията за обновленията в Discord и социалните мрежи', 'Идеи за ивенти и конкурси с играчите', 'Обратна връзка от играчите към екипа'],
    fits: 'Пишеш добре и имаш идеи как да зарадваш и да доведеш играчи.',
  },
  {
    id: 'designer', label: 'Графичен дизайнер', emoji: '🎨', hours: 'по задачи', open: true,
    does: ['Банери и картинки за обявленията', 'Иконки и идеи за нови екрани, камиони и предмети'],
    fits: 'Имаш примери от свои работи — покажи ни ги.',
  },
];

export const careerRole = (id: string) => CAREER_ROLES.find((r) => r.id === id);

/** How applying works, step by step (the „Кариери в TransVerse“ page). */
export const CAREER_STEPS = [
  { title: 'Кандидатура', body: 'Попълваш формуляра на тази страница. Отнема около 5 минути.' },
  { title: 'Разговор', body: 'Кратък разговор (15–20 минути), гласово или в чат. Не е изпит.' },
  { title: 'Изпитателен период', body: '3–4 седмици с малки задачи. И двете страни преценяват дали си пасваме.' },
  { title: 'В екипа', body: 'Получаваш правата на ролята, значката „Екип TransVerse“ и VIP, докато си в екипа.' },
] as const;

/** What we look for in anyone who joins, whatever the role. */
export const CAREER_TRAITS = [
  'Редовност: по няколко часа всяка седмица',
  'Учтивост и търпение към играчите',
  'Дискретност: каквото е в екипа, остава в екипа',
  'Да казваш, когато нямаш време — това е нормално',
] as const;

/** Tips for a good application. */
export const CAREER_TIPS = [
  'Кажи откога и колко често играеш.',
  'Напиши защо искаш точно тази роля.',
  'Дай пример: нещо, което си организирал, написал, нарисувал или поправил.',
  'Кажи честно колко часа седмично имаш.',
  'Остави контакт, на който наистина отговаряш.',
] as const;

/** Questions players ask about joining. */
export const CAREER_FAQ = [
  { q: 'Платено ли е?', a: 'Засега не: всички роли са доброволни, защото играта още няма приход.' },
  { q: 'Колко време ще ми отнема?', a: 'Зависи от ролята — обикновено между 2 и 6 часа седмично, в удобно за теб време. Графичният дизайн е по задачи.' },
  { q: 'Мога ли да кандидатствам за повече от една роля?', a: 'Имаш една кандидатура. Можеш да я промениш по всяко време, докато не сме започнали разговор с теб.' },
  { q: 'Кога ще получа отговор?', a: 'Ще получиш известие в играта, когато статусът на кандидатурата се промени. Виждаш го и на тази страница.' },
  { q: 'Как става човек ръководител на играта?', a: 'Тази роля се дава по покана, сред хората, които вече познаваме. Най-добрият път към нея е да започнеш като модератор.' },
  { q: 'Ако ми откажат?', a: 'Можеш да кандидатстваш отново по-късно — например когато имаш повече време или опит в играта.' },
] as const;

export const CAREERS = {
  /** Text limits for the form. */
  aboutMax: 1500,
  linkMax: 300,
  contactMax: 120,
  /** The youngest age that may apply. */
  minAge: 16,
  badge: 'team',
} as const;

export type ApplicationStatus = 'new' | 'reviewing' | 'interview' | 'accepted' | 'rejected';
export const APPLICATION_STATUSES: ApplicationStatus[] = ['new', 'reviewing', 'interview', 'accepted', 'rejected'];
export const STATUS_LABELS: Record<ApplicationStatus, string> = { new: 'Нова', reviewing: 'Разглеждаме', interview: 'Разговор', accepted: 'Приет', rejected: 'Отказ' };

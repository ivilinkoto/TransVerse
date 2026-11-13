/**
 * 1.3.1 „Екипът“: TransVerse looks for people. The open roles, what they do, what they get
 * now and later, and how we choose — shown in the one-time window after login and on the
 * „Кариери“ page, where a player applies. The applications are read by the admins.
 */
export type CareerRole = 'community' | 'moderator' | 'designer' | 'operations' | 'tester' | 'game_designer';

export interface CareerRoleDef { id: CareerRole; label: string; emoji: string; hours: string; does: string[]; fits: string; open: boolean }

export const CAREER_ROLES: CareerRoleDef[] = [
  {
    id: 'community', label: 'Ръководител общност и маркетинг', emoji: '📣', hours: '5–10 ч седмично', open: true,
    does: ['Facebook, Instagram, TikTok и Discord на играта', 'Публикации за всяко обновление', 'Конкурси и събития с играчите', 'Връзка със стриймъри и YouTube канали'],
    fits: 'Обичаш да пишеш, имаш усет за социалните мрежи и идеи как да доведеш нови играчи.',
  },
  {
    id: 'moderator', label: 'Модератор и поддръжка', emoji: '🛡️', hours: '3–5 ч седмично', open: true,
    does: ['Отговаря на запитванията в играта и в Discord', 'Пази реда в чата и разглежда докладите', 'Събира бъгове и ги описва ясно'],
    fits: 'Спокоен си, учтив си, познаваш играта добре и си тук редовно. Не е нужен опит.',
  },
  {
    id: 'designer', label: 'Графичен дизайнер', emoji: '🎨', hours: 'по задачи', open: true,
    does: ['Картинки за публикациите и банери', 'Иконки, лого и макети на нови екрани', 'Визуални идеи за нови камиони, сгради и предмети'],
    fits: 'Имаш портфолио или примери — покажи ни ги.',
  },
  {
    id: 'operations', label: 'Оперативен мениджър', emoji: '🧭', hours: '10–15 ч седмично', open: true,
    does: ['Води екипа ден за ден и седмичната среща', 'Разпределя задачите и следи сроковете', 'Следи числата: нови играчи, задържане, приходи', 'Подготвя плана за обновленията заедно със създателя'],
    fits: 'Умееш да организираш хора, имаш опит с екип или проект. След доказани резултати — път към изпълнителен директор.',
  },
  {
    id: 'tester', label: 'Тестер на обновленията', emoji: '🧪', hours: '2–4 ч седмично', open: true,
    does: ['Пробва новите функции преди всички — на телефон и компютър', 'Описва какво не работи и какво може да е по-добре'],
    fits: 'Внимателен си към детайлите и обичаш да откриваш грешки.',
  },
  {
    id: 'game_designer', label: 'Гейм дизайнер', emoji: '🎲', hours: '3–5 ч седмично', open: true,
    does: ['Идеи за нови системи и събития', 'Баланс на наградите и цените', 'Събира желанията на играчите и ги подрежда по важност'],
    fits: 'Играеш много, мислиш как играта може да е по-интересна и можеш да обясниш защо.',
  },
];

export const careerRole = (id: string) => CAREER_ROLES.find((r) => r.id === id);

/** What a member of the team gets — now and when the game makes a profit. */
export const CAREER_OFFER = {
  now: ['Роля и значка „Екип TransVerse“ в играта и в Discord', 'VIP и ТрансКоин всеки месец', 'Ранен достъп до всички обновления и думата си в това какво да се прави', 'Реален опит и препоръка за CV и портфолио'],
  later: ['Дял от печалбата, когато TransVerse започне да носи печалба — записан в писмен договор', 'Делът се натрупва с времето, в което си в екипа', 'Работа от вкъщи, в удобно за теб време'],
  process: ['Попълваш кратък формуляр тук', 'Кратък разговор в Discord (20–30 минути)', 'Малка пробна задача (1–3 часа)', 'Изпитателен месец', 'Договор и място в екипа'],
} as const;

export const CAREERS = {
  /** Text limits for the form. */
  aboutMax: 1500,
  linkMax: 300,
  contactMax: 120,
  badge: 'team',
} as const;

export type ApplicationStatus = 'new' | 'reviewing' | 'interview' | 'accepted' | 'rejected';
export const APPLICATION_STATUSES: ApplicationStatus[] = ['new', 'reviewing', 'interview', 'accepted', 'rejected'];
export const STATUS_LABELS: Record<ApplicationStatus, string> = { new: 'Нова', reviewing: 'Разглеждаме', interview: 'Разговор', accepted: 'Приет', rejected: 'Отказ' };

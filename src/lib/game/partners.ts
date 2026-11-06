/**
 * 1.2.3.1 „За партньори“ (feature `partners`): the public page for sponsors,
 * content creators, press and business, and the form that reaches the staff.
 * Texts are Bulgarian and go through the catalogue like any other.
 */
export const PARTNER_KINDS = ['sponsor', 'creator', 'press', 'business'] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];

export interface PartnerOffer { kind: PartnerKind; icon: 'megaphone' | 'video' | 'newspaper' | 'briefcase'; title: string; lead: string; points: string[] }

/** What each kind of partner gets — the cards on the page (and the choices of the form). */
export const PARTNER_OFFERS: PartnerOffer[] = [
  {
    kind: 'sponsor',
    icon: 'megaphone',
    title: 'Спонсорство и реклама',
    lead: 'Твоята марка там, където играчите прекарват вечерите си — по пътя.',
    points: ['Спонсориран ивент или сезон с твоето име и награди', 'Специални товари и мисии с твоя продукт', 'Банер на сайта и в Discord'],
  },
  {
    kind: 'creator',
    icon: 'video',
    title: 'Стриймъри и създатели',
    lead: 'Играеш на живо или правиш видеа? Карай с нас.',
    points: ['Личен промокод с награда за твоите зрители', 'Ранен достъп до обновленията', 'Роля и канал в Discord, подарък VIP'],
  },
  {
    kind: 'press',
    icon: 'newspaper',
    title: 'Преса и медии',
    lead: 'Пишеш за игри, технологии или транспорт?',
    points: ['Факти и снимки от играта', 'Интервю с екипа', 'Новините преди всички'],
  },
  {
    kind: 'business',
    icon: 'briefcase',
    title: 'Бизнес и инвестиции',
    lead: 'Логистична, транспортна или технологична компания? Да поговорим.',
    points: ['Брандирана компания или депо в играта', 'Обучителни сценарии за шофьори и диспечери', 'Инвестиции и дългосрочно партньорство'],
  },
];

export const PARTNER_LIMITS = { name: 80, org: 120, link: 300, message: 2000, minMessage: 20, perHour: 3 } as const;

export const partnerKindLabel = (kind: string) => PARTNER_OFFERS.find((o) => o.kind === kind)?.title ?? kind;

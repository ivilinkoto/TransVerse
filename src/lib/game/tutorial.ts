/** Onboarding steps. `auto` steps complete from real game state; others by a player action. */
export interface TutorialStep {
  key: 'welcome' | 'first_contract' | 'track_map' | 'first_delivery' | 'finances' | 'company_goal';
  title: string;
  body: string;
  href: string;
  cta: string;
  completion: 'ack' | 'auto' | 'visit';
}

export const TUTORIAL: TutorialStep[] = [
  { key: 'welcome', title: 'Добре дошъл, шофьоре!', body: 'Започваш като самостоятелен шофьор с нает камион Hemus R12 (до 7.5 т). Наемът се удържа от всяка доставка, а горивото, пътните такси и сервизът са за сметка на наемодателя.', href: '/game', cta: 'Да започваме', completion: 'ack' },
  { key: 'first_contract', title: 'Приеми първата си поръчка', body: 'Отвори „Транспортни поръчки“, включи „Само изпълними“, разгледай маршрута и печалбата и натисни „Приеми и изпрати“.', href: '/game/contracts', cta: 'Към поръчките', completion: 'auto' },
  { key: 'track_map', title: 'Проследи камиона на картата', body: 'Камионът се движи по реалния пътен маршрут. Времето за курс зависи от разстоянието (около 15 минути за 150 км, около час за 1 200 км) и продължават и когато не си в играта.', href: '/game/map', cta: 'Отвори картата', completion: 'visit' },
  { key: 'first_delivery', title: 'Завърши първата доставка', body: 'Когато камионът пристигне, плащането идва автоматично. Ще получиш известие. Междувременно можеш да разгледаш класациите и сезона.', href: '/game/fleet', cta: 'Виж автопарка', completion: 'auto' },
  { key: 'finances', title: 'Разгледай финансите', body: 'В счетоводната книга виждаш навлото, наема и бонусите от всяка доставка. Така ще прецениш кои курсове са най-изгодни.', href: '/game/finance', cta: 'Към финансите', completion: 'visit' },
  { key: 'company_goal', title: 'Следваща цел: собствена компания', body: 'С компания купуваш и наемаш повече техника, наемаш шофьори и откриваш депа. Виж изискванията в „Транспортна компания“.', href: '/game/company', cta: 'Виж изискванията', completion: 'visit' },
];

export type TutorialKey = TutorialStep['key'];

/** Onboarding steps. `auto` steps complete from real game state; others by a player action. */
export interface TutorialStep {
  key: 'welcome' | 'first_contract' | 'track_map' | 'first_delivery' | 'finances' | 'company_goal';
  title: string;
  body: string;
  href: string;
  cta: string;
  completion: 'ack' | 'auto' | 'visit';
  /** 1.1.4.1: what to press — the first visible match of these selectors glows. */
  spot?: string[];
}

export const TUTORIAL: TutorialStep[] = [
  { key: 'welcome', title: 'Добре дошъл, шофьоре!', body: 'Започваш с нает камион (до 7,5 т). Наемът се взима от всеки курс — горивото и сервизът не са твоя грижа.', href: '/game', cta: 'Да започваме', completion: 'ack' },
  { key: 'first_contract', title: 'Приеми първата си поръчка', body: 'Отвори „Поръчки“, избери товар и изпрати камиона.', href: '/game/contracts', cta: 'Към поръчките', completion: 'auto', spot: ['[data-tour="take"]', 'a[href="/game/contracts"]'] },
  { key: 'track_map', title: 'Проследи камиона на картата', body: 'Камионът кара по истинските пътища — и докато не си в играта.', href: '/game/map', cta: 'Отвори картата', completion: 'visit', spot: ['a[href="/game/map"]'] },
  { key: 'first_delivery', title: 'Завърши първата доставка', body: 'Щом камионът пристигне, парите идват сами и получаваш известие.', href: '/game/fleet', cta: 'Виж автопарка', completion: 'auto', spot: ['a[href="/game/fleet"]'] },
  { key: 'finances', title: 'Разгледай финансите', body: 'Тук виждаш колко ти донесе всеки курс.', href: '/game/finance', cta: 'Към финансите', completion: 'visit' },
  { key: 'company_goal', title: 'Следваща цел: собствена компания', body: 'С компания купуваш повече камиони и наемаш шофьори.', href: '/game/company', cta: 'Виж изискванията', completion: 'visit' },
];

export type TutorialKey = TutorialStep['key'];

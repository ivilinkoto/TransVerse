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
  /** 1.2.2: what changes with the new menu (nav_v2) — the same step, pointing at the new places. */
  v2?: Partial<Pick<TutorialStep, 'title' | 'body' | 'href' | 'cta' | 'spot'>>;
}

export const TUTORIAL: TutorialStep[] = [
  { key: 'welcome', title: 'Добре дошъл, шофьоре!', body: 'Започваш с нает камион (до 7,5 т). Наемът се взима от всеки курс — горивото и сервизът не са твоя грижа.', href: '/game', cta: 'Да започваме', completion: 'ack' },
  { key: 'first_contract', title: 'Приеми първата си поръчка', body: 'Отвори „Поръчки“, избери товар и изпрати камиона.', href: '/game/contracts', cta: 'Към поръчките', completion: 'auto', spot: ['[data-tour="take"]', 'a[href="/game/contracts"]'], v2: { body: 'Отвори „Курсове“, избери товар и изпрати камиона.', cta: 'Към курсовете' } },
  { key: 'track_map', title: 'Проследи камиона на картата', body: 'Камионът кара по истинските пътища — и докато не си в играта.', href: '/game/map', cta: 'Отвори картата', completion: 'visit', spot: ['a[href="/game/map"]'], v2: { body: 'Картата е най-горе в „Курсове“ — камионът кара по истинските пътища, и докато не си в играта.', href: '/game/contracts', cta: 'Към курсовете', spot: ['[data-testid="jobs-map"]', 'a[href="/game/contracts"]'] } },
  { key: 'first_delivery', title: 'Завърши първата доставка', body: 'Щом камионът пристигне, парите идват сами и получаваш известие.', href: '/game/fleet', cta: 'Виж автопарка', completion: 'auto', spot: ['a[href="/game/fleet"]'] },
  { key: 'finances', title: 'Разгледай финансите', body: 'Тук виждаш колко ти донесе всеки курс.', href: '/game/finance', cta: 'Към финансите', completion: 'visit', v2: { body: 'Тук виждаш колко ти донесе всеки курс. Финансите са в „Още“.' } },
  { key: 'company_goal', title: 'Следваща цел: собствена компания', body: 'С компания купуваш повече камиони и наемаш шофьори.', href: '/game/company', cta: 'Виж изискванията', completion: 'visit', v2: { body: 'С компания купуваш повече камиони и наемаш шофьори. „Компания“ е в „Още“.' } },
];

export type TutorialKey = TutorialStep['key'];

/** 1.2.2: the step as the viewer sees it — with the new menu, its v2 text and links. */
export const tutorialView = (step: TutorialStep, v2: boolean): TutorialStep => (v2 && step.v2 ? { ...step, ...step.v2 } : step);

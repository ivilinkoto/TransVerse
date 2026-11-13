/** One-time hints about the game's systems, shown once until the player closes them. */
export const HINTS = {
  board: { title: 'Диспечер, любими линии и рискове', body: '„Предложи курсове“ избира курс за всеки свободен камион. ★ запазва линията. Уморен шофьор или претоварване — риск от глоба.' },
  crew: { title: 'Умора и двоен екипаж', body: 'Шофьорът се уморява от курс на курс. Втори шофьор кара до 18 ч без почивка. Всяко ниво дава точка умение.' },
  clients: { title: 'Договори с клиенти', body: 'Няколко товара по една линия до срок: по-добро заплащане и бонус накрая. Закъснееш ли — губиш репутация.' },
  analytics: { title: 'Анализ', body: 'Кой камион, шофьор и линия носят най-много — след разходите по курса.' },
  discord: { title: 'Discord сървър', body: 'TransVerse има Discord сървър за новини, въпроси и търсене на компания.' },
  // 1.3.1: the one-time window „TransVerse търси хора“ after login.
  careers: { title: 'TransVerse търси хора', body: 'Събираме екип — виж отворените позиции.' },
  insurance: { title: 'Застраховка', body: 'Застрахованият камион не плаща пътната помощ при повреда по пътя. Глобите не се покриват.' },
} as const;

export type HintId = keyof typeof HINTS;
export const HINT_IDS = Object.keys(HINTS) as HintId[];

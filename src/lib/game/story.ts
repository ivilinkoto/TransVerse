/**
 * Историята (v1.10): a campaign in chapters with characters of the game
 * (fictional). Each chapter has three tasks counted from your deliveries;
 * finishing it pays money, XP and ТрансКоин and opens the next one.
 */
export type StoryTask =
  | { kind: 'on_time'; target: number; label: string }
  | { kind: 'km'; target: number; label: string }
  | { kind: 'cities'; target: number; label: string }
  | { kind: 'heavy'; target: number; tons: number; label: string }
  | { kind: 'foreign'; target: number; label: string }
  | { kind: 'convoy'; target: number; label: string };

export interface StoryChapter {
  title: string;
  who: string;
  minLevel: number;
  intro: string;
  outro: string;
  tasks: [StoryTask, StoryTask, StoryTask];
  rewardCents: number;
  xp: number;
  coins: number;
}

export const STORY: StoryChapter[] = [
  {
    title: 'Ключовете на Бай Стоян', who: 'Бай Стоян, стар шофьор', minLevel: 1,
    intro: '„Четиридесет години съм карал, момче. Ключовете вече тежат на ръката ми — твой ред е. Но първо ми покажи, че пазиш срока.“',
    outro: '„Е, това вече е шофьор! Пази тази кабина като своя — тя е повече дом, отколкото си мислиш.“',
    tasks: [{ kind: 'on_time', target: 2, label: 'Достави 2 товара навреме' }, { kind: 'km', target: 300, label: 'Измини 300 км с товар' }, { kind: 'cities', target: 3, label: 'Посети 3 различни града' }],
    rewardCents: 1_500_00, xp: 300, coins: 5,
  },
  {
    title: 'Сивият вълк', who: 'Мария от диспечерската', minLevel: 3,
    intro: '„Фирма „Сив Вълк“ ООД взима всички тежки поръчки в района и казва, че новите не ставаме за тях. Хайде да им покажем.“',
    outro: '„Видя ли им физиономиите? Трима клиенти вече питат за теб по име.“',
    tasks: [{ kind: 'heavy', target: 2, tons: 10, label: 'Закарай 2 товара от поне 10 т' }, { kind: 'on_time', target: 5, label: 'Още 5 доставки навреме' }, { kind: 'km', target: 1_500, label: 'Измини 1 500 км с товар' }],
    rewardCents: 3_000_00, xp: 600, coins: 10,
  },
  {
    title: 'Отвъд границата', who: 'Бай Стоян', minLevel: 5,
    intro: '„Едно време на границата се чакаше по цял ден с термос и карти. Сега е по-лесно — но пак е друг свят. Иди и виж.“',
    outro: '„Сега вече си международен шофьор. Не забравяй откъде тръгна.“',
    tasks: [{ kind: 'foreign', target: 2, label: 'Достави 2 товара в чужбина' }, { kind: 'km', target: 3_000, label: 'Измини 3 000 км с товар' }, { kind: 'on_time', target: 5, label: '5 доставки навреме' }],
    rewardCents: 5_000_00, xp: 1_000, coins: 15,
  },
  {
    title: 'Колоната', who: 'Мария от диспечерската', minLevel: 6,
    intro: '„Сам си бърз, но заедно сте сила. Събери колона — или се включи в чужда — и докарай товара с другите.“',
    outro: '„Колоната ти мина по главната улица и половин град излезе да гледа. Хубаво беше.“',
    tasks: [{ kind: 'convoy', target: 2, label: 'Пристигни в 2 конвоя' }, { kind: 'on_time', target: 8, label: '8 доставки навреме' }, { kind: 'cities', target: 6, label: 'Посети 6 различни града' }],
    rewardCents: 7_500_00, xp: 1_500, coins: 20,
  },
  {
    title: 'Свой път', who: 'Бай Стоян', minLevel: 8,
    intro: '„Последно, момче. Не ти трябват повече съвети от мен — трябва ти само път. Покарай още малко и ела да пием по кафе.“',
    outro: '„Знаех си, че ще станеш. Ключовете вече са изцяло твои — и историята също.“',
    tasks: [{ kind: 'cities', target: 10, label: 'Посети 10 различни града' }, { kind: 'km', target: 6_000, label: 'Измини 6 000 км с товар' }, { kind: 'heavy', target: 5, tons: 15, label: '5 товара от поне 15 т' }],
    rewardCents: 12_000_00, xp: 2_500, coins: 30,
  },
];

export const STORY_BADGE = 'story';

/** How much a delivery adds to a task (cities are counted by the server: new ones only). */
export function taskStep(task: StoryTask, d: { onTime: boolean; km: number; tons: number; foreign: boolean; convoy: boolean; newCity: boolean }) {
  switch (task.kind) {
    case 'on_time': return d.onTime ? 1 : 0;
    case 'km': return Math.round(d.km);
    case 'cities': return d.newCity ? 1 : 0;
    case 'heavy': return d.tons >= task.tons ? 1 : 0;
    case 'foreign': return d.foreign ? 1 : 0;
    case 'convoy': return d.convoy && d.onTime ? 1 : 0;
  }
}

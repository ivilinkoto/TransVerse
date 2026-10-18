/**
 * Game versions and their release notes, newest first. A release becomes
 * visible to players at `publishedAt` (staff see it earlier, to check it);
 * every player gets the "Какво ново" window once, at the first visit after
 * that. Text is Bulgarian, shown as is.
 */

export type ReleaseIcon = 'pumpkin' | 'ghost' | 'truck' | 'trophy' | 'paint' | 'scroll' | 'sparkles' | 'map' | 'bell' | 'shield';

export interface ReleaseHighlight {
  icon: ReleaseIcon;
  title: string;
  body: string;
}

export interface ReleaseSection {
  title: string;
  items: string[];
}

export interface Release {
  version: string;
  name: string;
  /** ISO time the release goes live for players. */
  publishedAt: string;
  tagline: string;
  /** Seasonal look the release window uses. */
  theme?: 'halloween';
  highlights: ReleaseHighlight[];
  sections: ReleaseSection[];
}

/** The version before release notes existed. */
export const BASE_VERSION = '1.0';

export const RELEASES: Release[] = [
  {
    version: '1.1',
    name: 'Нощта на тиквите',
    publishedAt: '2026-10-18T00:00:00+03:00',
    tagline: 'Хелуин идва по пътищата на TransVerse: празничен вид, ивент с класация, тиквени поръчки, призрачен камион и нова боя.',
    theme: 'halloween',
    highlights: [
      { icon: 'pumpkin', title: 'Празничен вид', body: 'До 2 ноември TransVerse е в хелуински цветове — оранжево и лилаво, тиква на логото, паяжини, прилепи и мъгла. След празника играта сама се връща към обичайния си вид. Украсата се изключва от Настройки.' },
      { icon: 'trophy', title: 'Ивент „Нощта на тиквите“', body: 'Общ ивент от 24 октомври (18:00) до 1 ноември: всички заедно доставяме празнични товари. Всеки участник печели 2 000 €, опит и 20 TC, а най-добрите — VIP и още ТрансКоин.' },
      { icon: 'truck', title: 'Празнични поръчки', body: 'На борсата се появяват тикви, сладкиши, костюми, фенери и украса с оранжев етикет „Хелуин“ — плащат се с 30 % повече.' },
      { icon: 'ghost', title: 'Призрачният камион', body: 'Нощем (22:00–06:00) по пътя може да се появи светещ камион без шофьор. Не е опасен — носи 10 TC.' },
      { icon: 'sparkles', title: 'Хелуински мисии и значка', body: 'Четири празнични мисии с ТрансКоин и пари. Изпълни всичките и вземи значката „Тиквен шофьор 2026“ завинаги — с оранжева рамка около снимката ти.' },
      { icon: 'paint', title: 'Боя „Тиква“', body: 'Празнична оранжева боя с тиквена усмивка за твой камион (80 TC). Продава се само по Хелуин и остава на камиона.' },
    ],
    sections: [
      {
        title: 'Хелуин',
        items: [
          'Нов раздел Състезание → „Хелуин“ (само по празника) и банер на таблото: ивентът, мисиите, значката, боята и призрачният камион на едно място.',
          'Празничните поръчки се броят за ивента и за мисиите; наградите от мисиите може да вземеш до седмица след ивента.',
          'Докато тече „Нощта на тиквите“, обичайните автоматични ивенти почиват.',
          'Призрачният камион носи ТрансКоин и изпълнява мисия; бави курса само с миг и не струва нищо.',
        ],
      },
      {
        title: 'Ново',
        items: [
          'Прозорец „Какво ново“ при първия вход след обновление и страница „Обновления“ (менюто на профила) с описанията на всички версии. Версията се вижда долу в менюто.',
          'Празнични теми: включват се сами по дати и сами се изключват след празника. Администраторите могат да ги включат или изключат ръчно.',
          'Значки в профила: виждат се на картата на играча.',
        ],
      },
      {
        title: 'Промени',
        items: ['Настройки → „Празнична украса“: включи или изключи празничния вид само за себе си.'],
      },
    ],
  },
];

const parts = (v: string) => v.split('.').map((n) => Number(n) || 0);

/** -1, 0 or 1 like a comparator: is version a older, equal or newer than b. */
export function compareVersions(a: string, b: string): number {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Releases the viewer can see now (staff also see the ones not yet published). */
export function visibleReleases(now: Date, staff = false): Release[] {
  return RELEASES.filter((r) => staff || new Date(r.publishedAt) <= now).sort((a, b) => compareVersions(b.version, a.version));
}

/** The current game version for this viewer. */
export function currentVersion(now: Date, staff = false): string {
  return visibleReleases(now, staff)[0]?.version ?? BASE_VERSION;
}

/** The release to show in the "Какво ново" window, if the player has not seen it yet. */
export function unseenRelease(seenVersion: string | null, now: Date, staff = false): Release | null {
  const latest = visibleReleases(now, staff)[0];
  if (!latest) return null;
  return seenVersion && compareVersions(seenVersion, latest.version) >= 0 ? null : latest;
}

export function releaseByVersion(version: string): Release | undefined {
  return RELEASES.find((r) => r.version === version);
}

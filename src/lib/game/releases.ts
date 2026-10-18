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
      { icon: 'scroll', title: 'Какво ново', body: 'Всяко обновление вече има име и версия. При първия вход след него виждаш този прозорец, а всички обновления са в менюто на профила → „Обновления“.' },
    ],
    sections: [
      {
        title: 'Ново',
        items: [
          'Прозорец „Какво ново“ при първия вход след обновление и страница „Обновления“ с описанията на всички версии.',
          'Версията на играта се вижда долу в менюто.',
        ],
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

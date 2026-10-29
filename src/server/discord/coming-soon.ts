import { eq, like } from 'drizzle-orm';
import type { Database } from '@/server/db/client';
import { jobState } from '@/server/db/schema';
import { featureDate, featureLive, FEATURES, type FeatureId } from '@/lib/game/features';
import { releaseByVersion } from '@/lib/game/releases';
import { withLocale } from '@/i18n/als';
import { intlLocale, t, tx } from '@/i18n/t';
import { noPings } from './api';
import { appUrl, BRAND, discordConfig } from './config';
import { layoutChannel } from './layout';
import { pinPosted, postIn, removePosted, type Posted } from './guild';

/**
 * 1.1.3.2: channels of game features that are not out yet get one pinned
 * "Очаквайте" message (in the channel's language) saying what comes there and
 * with which update. When the feature is released the bot removes it, and the
 * channel's own announcements take over.
 */
export const COMING_SOON: { channel: string; lang: 'bg' | 'en' | 'ru'; feature: FeatureId; what: string }[] = [
  { channel: 'битки', lang: 'bg', feature: 'battles', what: 'Битките на компаниите' },
  { channel: 'en-battles', lang: 'en', feature: 'battles', what: 'Битките на компаниите' },
  { channel: 'ru-битвы', lang: 'ru', feature: 'battles', what: 'Битките на компаниите' },
  { channel: 'конвои', lang: 'bg', feature: 'convoy', what: 'Конвоите' },
  { channel: 'en-convoys', lang: 'en', feature: 'convoy', what: 'Конвоите' },
  { channel: 'ru-колонны', lang: 'ru', feature: 'convoy', what: 'Конвоите' },
  { channel: 'строежи', lang: 'bg', feature: 'company_plot', what: 'Базите и строежите на компаниите' },
  { channel: 'товар-на-деня', lang: 'bg', feature: 'daily_load', what: 'Товарът на деня' },
  { channel: 'en-load-of-the-day', lang: 'en', feature: 'daily_load', what: 'Товарът на деня' },
  { channel: 'ru-груз-дня', lang: 'ru', feature: 'daily_load', what: 'Товарът на деня' },
  { channel: 'ливреи', lang: 'bg', feature: 'livery_contest', what: 'Конкурсът за ливрея на месеца' },
  { channel: 'пристанище', lang: 'bg', feature: 'ship_calls', what: 'Корабите на пристанищата' },
  { channel: 'рали', lang: 'bg', feature: 'rally', what: 'Седмичното рали' },
  { channel: 'en-rally', lang: 'en', feature: 'rally', what: 'Седмичното рали' },
  { channel: 'ru-ралли', lang: 'ru', feature: 'rally', what: 'Седмичното рали' },
];

const stateKey = (channel: string) => `coming-soon:${channel}`;

/** The pinned message for one channel, written in its language. */
export function comingSoonMessage(entry: (typeof COMING_SOON)[number]) {
  return withLocale(entry.lang, () => {
    const version = FEATURES[entry.feature];
    const release = releaseByVersion(version);
    const at = featureDate(entry.feature);
    const when = at ? at.toLocaleDateString(intlLocale(), { timeZone: 'Europe/Sofia', day: 'numeric', month: 'long', year: 'numeric' }) : '';
    return {
      ...noPings,
      embeds: [{
        title: t('🔜 Очаквайте: {0}', tx(entry.what)),
        description: t('Идва с обновление {0}{1}{2}. Тогава тук ще излизат обявленията — дотогава каналът е тих.', version, release ? ` „${tx(release.name)}“` : '', when ? t(' на {0}', when) : ''),
        url: `${appUrl()}/updates`,
        color: BRAND,
        footer: { text: t('TransVerse · обновленията') },
      }],
    };
  });
}

/** Worker: posts (and pins) the missing notes, removes the ones whose feature is out. Returns how many changed. */
export async function syncComingSoon(db: Database, now = new Date()): Promise<number> {
  if (!discordConfig().bot || !featureLive('discord_coming_soon', now)) return 0;
  const rows = await db.select().from(jobState).where(like(jobState.key, 'coming-soon:%'));
  const pinned = new Map(rows.map((r) => [r.key, r.value as Posted]));
  let changed = 0;
  for (const entry of COMING_SOON) {
    const key = stateKey(entry.channel);
    const have = pinned.get(key);
    if (featureLive(entry.feature, now)) {
      if (!have) continue;
      await removePosted(have);
      await db.delete(jobState).where(eq(jobState.key, key));
      changed++;
      continue;
    }
    if (have) continue;
    const channelId = await layoutChannel(db, entry.channel);
    // The channel is not in the server (not set up yet): nothing to pin.
    if (!channelId) continue;
    // In a forum channel the note is a post of its own, pinned on top.
    const posted = await postIn(channelId, comingSoonMessage(entry));
    await pinPosted(posted);
    await db.insert(jobState).values({ key, value: posted }).onConflictDoUpdate({ target: jobState.key, set: { value: posted, updatedAt: now } });
    changed++;
  }
  return changed;
}

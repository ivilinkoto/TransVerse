import { t } from '@/i18n/t';
/** A player counts as online while their game tab keeps the live connection open (refreshed every minute). */
export const ONLINE_MS = 2.5 * 60_000;

export const isOnline = (lastSeenAt: Date | string | null | undefined, now: Date) => !!lastSeenAt && now.getTime() - new Date(lastSeenAt).getTime() < ONLINE_MS;

/** "онлайн", "преди 5 мин", "преди 3 ч", "преди 2 дни", "отдавна". */
export function lastSeenLabel(lastSeenAt: Date | string | null | undefined, now: Date): string {
  if (!lastSeenAt) return t('отдавна');
  const ms = now.getTime() - new Date(lastSeenAt).getTime();
  if (ms < ONLINE_MS) return t('онлайн');
  const min = Math.round(ms / 60_000);
  if (min < 60) return t('преди {0} мин', min);
  const h = Math.round(min / 60);
  if (h < 24) return t('преди {0} ч', h);
  const d = Math.round(h / 24);
  if (d < 60) return t('преди {0} {1}', d, d === 1 ? t('ден') : t('дни'));
  return t('отдавна');
}

/** World chat channels. Trade is only for buying and selling. */
export const CHANNELS = {
  global: { label: 'Глобален', perMinute: 6 },
  trade: { label: 'Търговия', perMinute: 3 },
} as const;
export type Channel = keyof typeof CHANNELS;
export const CHANNEL_IDS = Object.keys(CHANNELS) as Channel[];

export const MESSAGE_MAX = 500;

/** Unread chat messages are counted up to this many; more shows as "99+". */
export const UNREAD_CAP = 100;
export const unreadLabel = (n: number) => (n > 99 ? '99+' : String(n));
/** A quoted reply shows this much of the original message. */
export const REPLY_SNIPPET = 90;

/** Reactions under chat messages. */
export const REACTIONS = ['👍', '❤️', '😂', '🚚'] as const;
export type Reaction = (typeof REACTIONS)[number];
export interface ReactionSummary {
  emoji: Reaction;
  count: number;
  /** The viewer reacted with it. */
  mine: boolean;
  /** Who reacted (the first few). */
  names: string[];
}

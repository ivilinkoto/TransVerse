import { getDb } from '@/server/db/client';
import { handler } from '@/server/http';
import { pushToUser } from '@/server/push';
import { t } from '@/i18n/t';

/** Sends a test notification to all of the player's devices. */
export const POST = handler({ perMinute: 5 }, async ({ user }) => {
  const sent = await pushToUser(getDb(), user.id, { title: 'TransVerse', body: t('Известията работят! Ще ти пишем, когато камионът пристигне или има спешна доставка.'), url: '/game', tag: 'test' });
  return { ok: true, sent };
});

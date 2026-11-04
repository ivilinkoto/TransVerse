/**
 * 1.2.3 (feature `notification_buttons`): buttons right in a notification.
 * The notification's link carries the id (…?friend=<id>, …?trade=<id>, …?greet=<id>);
 * the page turns it into the same actions the other pages use.
 */
export interface NotificationButton { label: string; action: Record<string, unknown>; primary?: boolean }

export function notificationButtons(href: string | null | undefined): NotificationButton[] {
  if (!href) return [];
  const q = href.split('#')[0]!.split('?')[1];
  if (!q) return [];
  const p = new URLSearchParams(q);
  const id = (k: string) => { const v = p.get(k); return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null; };
  const friend = id('friend'), trade = id('trade'), greet = id('greet');
  if (friend) return [{ label: 'Приеми', action: { type: 'friendRespond', friendshipId: friend, accept: true }, primary: true }, { label: 'Откажи', action: { type: 'friendRespond', friendshipId: friend, accept: false } }];
  if (trade) return [{ label: 'Приеми', action: { type: 'answerTrade', id: trade, answer: 'accept' }, primary: true }, { label: 'Откажи', action: { type: 'answerTrade', id: trade, answer: 'decline' } }];
  if (greet) return [{ label: 'Поздрави', action: { type: 'greetNewcomer', userId: greet }, primary: true }];
  return [];
}

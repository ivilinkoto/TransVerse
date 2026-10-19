/* TransVerse service worker: shows push notifications and opens the game when one is tapped. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'TransVerse', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'TransVerse';
  const actions = Array.isArray(data.actions) ? data.actions.filter((a) => a && typeof a.action === 'string' && typeof a.title === 'string' && typeof a.url === 'string' && a.url.startsWith('/')).slice(0, 2) : [];
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      // Sound is the device's notification sound; phones also vibrate.
      silent: false,
      vibrate: [120, 60, 120, 60, 240],
      data: {
        url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/game',
        // Quick buttons: where each one leads (same-site paths only).
        actions: Object.fromEntries(actions.map((a) => [a.action, a.url])),
      },
      actions: actions.map((a) => ({ action: a.action, title: a.title })),
      lang: 'bg',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  // A quick button leads to its own page; a tap on the notification to the main one.
  const url = (event.action && data.actions && data.actions[event.action]) || data.url || '/game';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

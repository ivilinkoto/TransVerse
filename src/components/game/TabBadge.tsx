'use client';

import { useEffect } from 'react';

const PREFIX = /^\(\d+\+?\) /;

/** 1.1.3.5: the unread notifications in the tab's title — "(3) Автопарк · TransVerse". */
export function TabBadge({ unread }: { unread: number }) {
  useEffect(() => {
    const apply = () => {
      const base = document.title.replace(PREFIX, '');
      const next = unread > 0 ? `(${unread > 99 ? '99+' : unread}) ${base}` : base;
      if (document.title !== next) document.title = next;
    };
    apply();
    // Every page sets its own title: put the count back after it.
    const head = document.querySelector('head');
    const watch = new MutationObserver(apply);
    if (head) watch.observe(head, { subtree: true, childList: true, characterData: true });
    return () => {
      watch.disconnect();
      document.title = document.title.replace(PREFIX, '');
    };
  }, [unread]);
  return null;
}

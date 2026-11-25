'use client';

import { useEffect } from 'react';

/** 1.2.3: the player's look — light theme and bigger text — on the page root (undone when leaving the game). */
export function LookApply({ theme, textSize, tycoon = false }: { theme?: 'dark' | 'light'; textSize?: 'normal' | 'large' | 'xl'; tycoon?: boolean }) {
  useEffect(() => {
    const root = document.documentElement;
    // 1.4: the „Тайкун“ look is its own dark world — on the root too, so windows (portals to <body>) get it.
    if (theme === 'light' && !tycoon) root.dataset.theme = 'light'; else delete root.dataset.theme;
    if (tycoon) root.dataset.style = 'tycoon'; else delete root.dataset.style;
    root.style.fontSize = textSize === 'xl' ? '125%' : textSize === 'large' ? '112.5%' : '';
    return () => { delete root.dataset.theme; delete root.dataset.style; root.style.fontSize = ''; };
  }, [theme, textSize, tycoon]);
  return null;
}

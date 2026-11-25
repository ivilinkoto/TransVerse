'use client';

import { useEffect } from 'react';

/** 1.2.3: the player's look — light theme and bigger text — on the page root (undone when leaving the game). */
export function LookApply({ theme, textSize }: { theme?: 'dark' | 'light'; textSize?: 'normal' | 'large' | 'xl' }) {
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') root.dataset.theme = 'light'; else delete root.dataset.theme;
    root.style.fontSize = textSize === 'xl' ? '125%' : textSize === 'large' ? '112.5%' : '';
    return () => { delete root.dataset.theme; root.style.fontSize = ''; };
  }, [theme, textSize]);
  return null;
}

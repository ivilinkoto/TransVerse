import type { MetadataRoute } from 'next';
import { t } from '@/i18n/t';

/** Lets players install TransVerse on the home screen (needed for notifications on iPhone). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: t('TransVerse — транспортна игра'),
    short_name: 'TransVerse',
    description: t('Браузърна мултиплейър транспортна и икономическа игра върху реалната карта.'),
    lang: 'bg',
    start_url: '/game',
    scope: '/',
    display: 'standalone',
    background_color: '#05070b',
    theme_color: '#05070b',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

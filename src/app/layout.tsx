import type { Metadata, Viewport } from 'next';
import { Exo_2, JetBrains_Mono, Onest } from 'next/font/google';
import './globals.css';
import { SeasonalDecor } from '@/components/seasonal/SeasonalDecor';
import { requestSeason } from '@/server/seasonal';

const display = Exo_2({ subsets: ['latin', 'cyrillic'], variable: '--font-display-face', weight: ['600', '700', '800'] });
const sans = Onest({ subsets: ['latin', 'cyrillic'], variable: '--font-onest' });
const mono = JetBrains_Mono({ subsets: ['latin', 'cyrillic'], variable: '--font-jetbrains' });

export const metadata: Metadata = {
  title: { default: 'TransVerse — транспортна стратегия върху реалната карта', template: '%s · TransVerse' },
  description: 'Браузърна мултиплейър игра: изгради транспортна компания, изпълнявай поръчки по реални пътища между реални градове и се състезавай в общ постоянен свят.',
  applicationName: 'TransVerse',
  icons: { icon: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }], apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }] },
  appleWebApp: { capable: true, title: 'TransVerse', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = { themeColor: '#05070b', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Seasonal look (Halloween…): colours and decorations on top of the base design.
  const season = await requestSeason();
  return (
    <html lang="bg" className={`${display.variable} ${sans.variable} ${mono.variable}`} data-season={season ?? undefined}>
      <body>
        {children}
        {season && <SeasonalDecor season={season} />}
      </body>
    </html>
  );
}

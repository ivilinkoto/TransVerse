import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { SeasonalDecor } from '@/components/seasonal/SeasonalDecor';
import { requestSeason } from '@/server/seasonal';
import { configuredSiteUrl, DEFAULT_SITE_URL, OG_IMAGE } from '@/server/site';
import { I18nProvider } from '@/i18n/client';
import { OG_LOCALE } from '@/i18n/config';
import { initLocale, MESSAGES } from '@/i18n/server';
import { t } from '@/i18n/t';

// The fonts live in the project (src/app/fonts, SIL Open Font License): the build and the site do not
// depend on Google Fonts. Variable files, cut to Latin and Cyrillic and to the weights the game uses.
const display = localFont({ src: './fonts/Exo2.woff2', variable: '--font-display-face', weight: '600 800', display: 'swap' });
const sans = localFont({ src: './fonts/Onest.woff2', variable: '--font-onest', weight: '400 800', display: 'swap' });
const mono = localFont({ src: './fonts/JetBrainsMono.woff2', variable: '--font-jetbrains', weight: '400 700', display: 'swap' });

const TITLE_BG = 'TransVerse — транспортна стратегия върху реалната карта';
const DESCRIPTION_BG = 'Браузърна мултиплейър игра: изгради транспортна компания, изпълнявай поръчки по реални пътища между реални градове и се състезавай в общ постоянен свят.';

// Runtime, not build time: APP_URL lives in the server's env. Link previews (Facebook, Viber…) need absolute addresses.
export async function generateMetadata(): Promise<Metadata> {
  const locale = await initLocale();
  const TITLE = t(TITLE_BG);
  const DESCRIPTION = t(DESCRIPTION_BG);
  return {
    metadataBase: new URL(configuredSiteUrl() ?? DEFAULT_SITE_URL),
    title: { default: TITLE, template: '%s · TransVerse' },
    description: DESCRIPTION,
    applicationName: 'TransVerse',
    openGraph: { type: 'website', siteName: 'TransVerse', locale: OG_LOCALE[locale], title: TITLE, description: DESCRIPTION, url: '/', images: [OG_IMAGE] },
    twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: [OG_IMAGE] },
    icons: { icon: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }], apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }] },
    appleWebApp: { capable: true, title: 'TransVerse', statusBarStyle: 'black-translucent' },
  };
}

export const viewport: Viewport = { themeColor: '#05070b', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await initLocale();
  // Seasonal look (Halloween…): colours and decorations on top of the base design.
  const locale = await initLocale();
  const season = await requestSeason();
  return (
    <html lang={locale} className={`${display.variable} ${sans.variable} ${mono.variable}`} data-season={season ?? undefined}>
      <body>
        <I18nProvider locale={locale} messages={MESSAGES[locale]}>{children}</I18nProvider>
        {season && <SeasonalDecor season={season} />}
      </body>
    </html>
  );
}

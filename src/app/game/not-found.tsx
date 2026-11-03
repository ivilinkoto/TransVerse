import Link from 'next/link';
import { Compass } from 'lucide-react';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

/**
 * 1.2.2: a game page that does not exist — or is not open for this player yet
 * (a feature of a coming update) — inside the game's frame, with the way back,
 * instead of the bare „404“.
 */
export default async function GameNotFound() {
  await initLocale();
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <Compass className="mx-auto h-12 w-12 text-cyan-glow" />
      <h1 className="mt-4 font-display text-2xl font-bold">{t('Тази страница я няма')}</h1>
      <p className="mt-2 text-sm text-mist-300">{t('Може връзката да е стара или страницата да идва с някое от следващите обновления.')}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link href="/game" className="btn-primary">{t('Към таблото')}</Link>
        <Link href="/game/updates" className="btn-ghost">{t('Обновления')}</Link>
      </div>
    </div>
  );
}

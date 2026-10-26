import type { Metadata } from 'next';
import { ArrowLeft, ScrollText } from 'lucide-react';
import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { ReleaseFold } from '@/components/game/ReleaseFold';
import { visibleReleases } from '@/lib/game/releases';
import { currentUser } from '@/server/http';
import { requestNow } from '@/server/site';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Обновления'), description: t('Какво ново във всяка версия на TransVerse — подробните описания на обновленията.') };
}
export const dynamic = 'force-dynamic';

/** Public release notes (the same as in the game, without signing in). */
export default async function PublicUpdatesPage() {
  await initLocale();
  const [user, now] = [await currentUser(), requestNow()];
  const releases = visibleReleases(now);
  return (
    <div className="min-h-screen">
      <header className="border-b border-asphalt-800/80 bg-asphalt-950/85">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Logo />
          {user ? <Link href="/game" className="btn-primary">{t('Към играта')}</Link> : <Link href="/register" className="btn-primary">{t('Регистрация')}</Link>}
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-6 px-4 py-10 sm:px-6">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-mist-400 hover:text-white"><ArrowLeft className="h-4 w-4" />{' '}{t('Начало')}</Link>
        <div>
          <h1 className="font-display text-3xl font-bold sm:text-4xl">{t('Обновления')}</h1>
          <p className="mt-2 text-mist-300">{t('Какво ново във всяка версия на TransVerse.')}</p>
        </div>
        {releases.length === 0 ? (
          <div className="panel flex items-center gap-3 p-6 text-mist-300"><ScrollText className="h-5 w-5" />{' '}{t('Описанията ще се появяват тук.')}</div>
        ) : (
          releases.map((r, i) => (
            <ReleaseFold key={r.version} release={r} heading={i === 0 ? 'h2' : 'h3'} className="panel p-5 sm:p-7" />
          ))
        )}
      </main>
    </div>
  );
}

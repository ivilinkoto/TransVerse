import type { Metadata } from 'next';
import { ArrowLeft, ScrollText } from 'lucide-react';
import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { ReleaseBody, ReleaseTitle } from '@/components/game/ReleaseNotes';
import { visibleReleases } from '@/lib/game/releases';
import { currentUser } from '@/server/http';
import { requestNow } from '@/server/site';

export const metadata: Metadata = { title: 'Обновления', description: 'Какво ново във всяка версия на TransVerse — подробните описания на обновленията.' };
export const dynamic = 'force-dynamic';

/** Public release notes (the same as in the game, without signing in). */
export default async function PublicUpdatesPage() {
  const [user, now] = [await currentUser(), requestNow()];
  const releases = visibleReleases(now);
  return (
    <div className="min-h-screen">
      <header className="border-b border-asphalt-800/80 bg-asphalt-950/85">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Logo />
          {user ? <Link href="/game" className="btn-primary">Към играта</Link> : <Link href="/register" className="btn-primary">Регистрация</Link>}
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-6 px-4 py-10 sm:px-6">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-mist-400 hover:text-white"><ArrowLeft className="h-4 w-4" /> Начало</Link>
        <div>
          <h1 className="font-display text-3xl font-bold sm:text-4xl">Обновления</h1>
          <p className="mt-2 text-mist-300">Какво ново във всяка версия на TransVerse.</p>
        </div>
        {releases.length === 0 ? (
          <div className="panel flex items-center gap-3 p-6 text-mist-300"><ScrollText className="h-5 w-5" /> Описанията ще се появяват тук.</div>
        ) : (
          releases.map((r, i) => (
            <article key={r.version} id={`v${r.version}`} className="panel scroll-mt-6 p-5 sm:p-7">
              <ReleaseTitle release={r} as={i === 0 ? 'h2' : 'h3'} />
              <div className="mt-5"><ReleaseBody release={r} /></div>
            </article>
          ))
        )}
      </main>
    </div>
  );
}

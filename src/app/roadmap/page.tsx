import type { Metadata } from 'next';
import { ArrowLeft, Rocket } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Logo } from '@/components/brand/Logo';
import { featureLive } from '@/lib/game/features';
import { comingReleases } from '@/lib/game/releases';
import { currentUser } from '@/server/http';
import { testsUnreleased } from '@/server/auth/roles';
import { requestNow } from '@/server/site';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Какво предстои'), description: t('Следващите обновления на TransVerse — накратко, без дати.') };
}
export const dynamic = 'force-dynamic';

/** 1.1.4: the next few releases — their names and highlight titles only (no dates, no details). */
export default async function RoadmapPage() {
  await initLocale();
  const [user, now] = [await currentUser(), requestNow()];
  // Staff see it before the release, as every new feature.
  if (!featureLive('roadmap', now) && !(user && testsUnreleased(user))) notFound();
  const coming = comingReleases(now);
  return (
    <div className="min-h-screen">
      <header className="border-b border-asphalt-800/80 bg-asphalt-950/85">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Logo />
          {user ? <Link href="/game" className="btn-primary">{t('Към играта')}</Link> : <Link href="/register" className="btn-primary">{t('Регистрация')}</Link>}
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-6 px-4 py-10 sm:px-6">
        <Link href="/updates" className="inline-flex items-center gap-1.5 text-sm text-mist-400 hover:text-white"><ArrowLeft className="h-4 w-4" />{' '}{t('Обновления')}</Link>
        <div>
          <h1 className="font-display text-3xl font-bold sm:text-4xl">{t('Какво предстои')}</h1>
          <p className="mt-2 text-mist-300">{t('Върху какво работим за следващите обновления. Подробностите — в деня на излизането. Имаш идея? Предложи я в играта, в „Идеи“.')}</p>
        </div>
        {coming.length === 0 ? (
          <div className="panel flex items-center gap-3 p-6 text-mist-300"><Rocket className="h-5 w-5" />{' '}{t('Следващото обновление се подготвя.')}</div>
        ) : (
          coming.map((r, i) => (
            <section key={r.version} className="panel p-5 sm:p-7">
              <div className="label text-cyan-glow">{i === 0 ? t('Следващото') : t('След това')}</div>
              <h2 className="mt-1 font-display text-2xl font-bold">{t('Версия {0} — „{1}“', r.version, tx(r.name))}</h2>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {r.highlights.slice(0, 8).map((h) => <li key={h.title} className="rounded-xl border border-asphalt-700 bg-asphalt-850 px-3 py-2 text-sm font-semibold">{tx(h.title)}</li>)}
              </ul>
            </section>
          ))
        )}
      </main>
    </div>
  );
}

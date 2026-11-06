import type { Metadata } from 'next';
import { Briefcase, Megaphone, Newspaper, Route, Video, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Logo } from '@/components/brand/Logo';
import { PartnerForm } from '@/components/partners/PartnerForm';
import { int } from '@/lib/format';
import { featureLive } from '@/lib/game/features';
import { PARTNER_KINDS, PARTNER_OFFERS, type PartnerKind } from '@/lib/game/partners';
import { testsUnreleased } from '@/server/auth/roles';
import { getDb } from '@/server/db/client';
import { currentUser } from '@/server/http';
import { partnerFacts } from '@/server/partners';
import { OG_IMAGE, requestNow } from '@/server/site';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  const title = t('За партньори');
  const description = t('Спонсорство, стриймъри, преса и бизнес — да изминем пътя заедно с TransVerse.');
  return { title, description, openGraph: { title, description, images: [OG_IMAGE] } };
}
export const dynamic = 'force-dynamic';

const ICONS: Record<(typeof PARTNER_OFFERS)[number]['icon'], LucideIcon> = { megaphone: Megaphone, video: Video, newspaper: Newspaper, briefcase: Briefcase };

/** 1.2.3.1 „За партньори“: what we offer sponsors, creators, press and business, and the form that reaches the team. */
export default async function PartnersPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  await initLocale();
  const [user, now, { kind }] = [await currentUser(), requestNow(), await searchParams];
  if (!featureLive('partners', now) && !(user && testsUnreleased(user))) notFound();
  const facts = await partnerFacts(getDb());
  const chosen = PARTNER_KINDS.includes(kind as PartnerKind) ? (kind as PartnerKind) : undefined;
  const stats = [
    // Small numbers do not help a pitch: players and trips appear from a threshold.
    ...(facts.players >= 100 ? [{ value: int(facts.players), label: t('играчи') }] : []),
    ...(facts.deliveries >= 1000 ? [{ value: int(facts.deliveries), label: t('завършени курса') }] : []),
    { value: int(facts.cities), label: t('реални града') },
    { value: int(facts.countries), label: t('държави') },
  ];
  return (
    <div className="min-h-screen">
      <header className="border-b border-asphalt-800/80 bg-asphalt-950/85">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Logo />
          {user ? <Link href="/game" className="btn-ghost">{t('Към играта')}</Link> : <Link href="/register" className="btn-ghost">{t('Играй безплатно')}</Link>}
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-12 px-4 py-10 sm:px-6 sm:py-14">
        <section className="relative overflow-hidden rounded-3xl border border-asphalt-700 bg-gradient-to-br from-asphalt-900 via-asphalt-950 to-asphalt-900 p-6 sm:p-10">
          <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-cyan-glow/10 blur-3xl" aria-hidden="true" />
          <div className="label flex items-center gap-2 text-cyan-glow"><Route className="h-4 w-4" />{t('За партньори')}</div>
          <h1 className="mt-3 max-w-2xl font-display text-3xl font-bold leading-tight sm:text-5xl">{t('Да изминем пътя заедно')}</h1>
          <p className="mt-4 max-w-2xl text-mist-300 sm:text-lg">{t('Браузърна транспортна игра върху истинската карта на Европа, направена в България.')}{' '}{t('Търсим марки, създатели и медии, с които да расте.')}</p>
          <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="partner-facts">
            {stats.map((s) => (
              <div key={s.label} className="rounded-2xl border border-asphalt-700 bg-asphalt-900/70 px-4 py-3">
                <dt className="text-xs text-mist-400">{s.label}</dt>
                <dd className="num font-display text-2xl font-bold text-white">{s.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-mist-400">{t('Данни от играта към днес.')}</p>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          {PARTNER_OFFERS.map((o) => {
            const Icon = ICONS[o.icon];
            return (
              <article key={o.kind} className="panel flex flex-col p-5 sm:p-6" data-testid={`partner-${o.kind}`}>
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-glow/10 text-cyan-glow"><Icon className="h-5 w-5" /></span>
                  <h2 className="font-display text-xl font-bold">{tx(o.title)}</h2>
                </div>
                <p className="mt-3 text-mist-300">{tx(o.lead)}</p>
                <ul className="mt-3 flex-1 space-y-1.5 text-sm">
                  {o.points.map((p) => <li key={p} className="flex gap-2"><span className="text-cyan-glow">›</span>{tx(p)}</li>)}
                </ul>
                <a href={`?kind=${o.kind}#write`} className="mt-4 self-start text-sm font-semibold text-cyan-glow hover:underline">{t('Пиши ни →')}</a>
              </article>
            );
          })}
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          {[
            { n: '1', title: t('Пишеш ни'), body: t('Няколко изречения: кой си и какво имаш предвид.') },
            { n: '2', title: t('Отговаряме'), body: t('Обикновено до 2 работни дни, от човек от екипа.') },
            { n: '3', title: t('Тръгваме'), body: t('Уточняваме подробностите и пускаме нещото в играта.') },
          ].map((s) => (
            <div key={s.n} className="rounded-2xl border border-asphalt-700 p-4">
              <div className="num font-display text-3xl font-bold text-cyan-glow/70">{s.n}</div>
              <div className="mt-1 font-semibold">{s.title}</div>
              <p className="mt-1 text-sm text-mist-400">{s.body}</p>
            </div>
          ))}
        </section>

        <section id="write" className="panel scroll-mt-6 p-5 sm:p-8">
          <h2 className="font-display text-2xl font-bold">{t('Пиши ни')}</h2>
          <p className="mt-1 text-sm text-mist-400">{t('Съобщението отива направо при екипа. За помощ с профила в играта използвай „Поддръжка“.')}</p>
          <div className="mt-5"><PartnerForm key={chosen ?? 'none'} kind={chosen} name={user?.username ?? ''} /></div>
        </section>
      </main>
    </div>
  );
}

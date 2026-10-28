import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, PageHeader } from '@/components/ui';
import { int, km } from '@/lib/format';
import { playerCareer } from '@/server/game/career';
import { gameContext } from '@/server/game/context';
import { playerCard } from '@/server/game/social';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Сравнение') };
}

/** 1.1.4: you next to another player — trips, km, tons, on time, countries, achievements (game data, no money). */
export default async function ComparePage({ params }: { params: Promise<{ username: string }> }) {
  await initLocale();
  const username = decodeURIComponent((await params).username);
  const { db, user, features } = await gameContext();
  if (!features.compare_players) notFound();
  const card = await playerCard(db, user.id, username);
  if (!card || card.relation === 'self') notFound();
  const [me, them] = await Promise.all([playerCareer(db, user.id), playerCareer(db, card.id)]);
  if (!me || !them) notFound();
  const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
  const rows = [
    { label: t('Курсове'), a: me.trips, b: them.trips, show: (v: number) => int(v) },
    { label: t('Километри'), a: me.km, b: them.km, show: (v: number) => km(v) },
    { label: t('Тонове'), a: me.tons, b: them.tons, show: (v: number) => t('{0} т', int(v)) },
    { label: t('Навреме'), a: me.onTimeShare ?? -1, b: them.onTimeShare ?? -1, show: (v: number) => pct(v < 0 ? null : v) },
    { label: t('Държави'), a: me.countries, b: them.countries, show: (v: number) => int(v) },
    { label: t('Постижения'), a: me.achievements, b: them.achievements, show: (v: number) => int(v) },
  ];
  const wins = rows.filter((r) => r.a > r.b).length;
  const losses = rows.filter((r) => r.b > r.a).length;
  return (
    <div className="space-y-6">
      <PageHeader title={t('Ти срещу {0}', card.username)} subtitle={wins > losses ? t('Водиш в {0} от {1} показателя. Така дръж!', wins, rows.length) : wins < losses ? t('{0} води в {1} от {2} показателя — има какво да наваксаш.', card.username, losses, rows.length) : t('Равни сте — следващият курс решава.')} actions={features.career ? <Link href={`/game/players/${encodeURIComponent(card.username)}`} className="btn-ghost">{t('Кариера на {0}', card.username)}</Link> : undefined} />
      <Card>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-4 gap-y-3 text-sm">
          <div className="text-right font-display font-bold text-cyan-glow">{tx(user.username)}</div>
          <div />
          <div className="font-display font-bold text-gold-400">{tx(card.username)}</div>
          {rows.map((r) => (
            <div key={r.label} className="contents">
              <div className={`num text-right text-lg ${r.a > r.b ? 'font-bold text-white' : 'text-mist-400'}`}>{r.show(r.a)}</div>
              <div className="text-center text-xs uppercase tracking-wide text-mist-400">{r.label}</div>
              <div className={`num text-lg ${r.b > r.a ? 'font-bold text-white' : 'text-mist-400'}`}>{r.show(r.b)}</div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-mist-400">{t('Брои се всичко, карано с твоите камиони и шофьори. Без пари — те са лична работа.')}</p>
      </Card>
    </div>
  );
}

import { Star } from 'lucide-react';
import { notFound } from 'next/navigation';
import { Card, PageHeader } from '@/components/ui';
import { NewCareerForm } from '@/components/game/NewCareerForm';
import { LEGACY, legacyShare } from '@/lib/game/empire';
import { date, int } from '@/lib/format';
import { users } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { headquarterOptions } from '@/server/game/company';
import { legacyBlockers, legacyOf } from '@/server/game/legacy';
import { eq } from 'drizzle-orm';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Наследство') };
}

/** v2.0 legacy (New Game+): the stars, the earlier careers and a new start. */
export default async function LegacyPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.legacy) notFound();
  const [[u], runs, blockers, cities] = await Promise.all([db.select({ stars: users.legacyStars, level: users.level }).from(users).where(eq(users.id, user.id)), legacyOf(db, user.id), legacyBlockers(db, user.id, now), headquarterOptions(db)]);
  const stars = u?.stars ?? 0;
  return (
    <div className="space-y-6">
      <PageHeader title={t('Наследство')} subtitle={t('От ниво {0} можеш да започнеш кариерата отначало — с нает камион и началните пари. Всяко ново начало дава звезда: +{1} % на всеки товар завинаги (до {2} звезди). ТрансКоин, VIP, значки, лицензи и приятели остават.', LEGACY.minLevel, Math.round(LEGACY.bonusPerStar * 100), LEGACY.maxStars)} />
      <Card title={<span className="flex items-center gap-2"><Star className="h-5 w-5 text-gold-400" />{t('Звезди: {0} / {1}', stars, LEGACY.maxStars)}</span>}>
        <p className="text-2xl" aria-hidden>{'⭐'.repeat(stars) || '☆'}</p>
        <p className="mt-1 text-sm text-mist-300">{stars ? t('Бонус на всеки товар: +{0} %.', Math.round(legacyShare(stars) * 100)) : t('Още нямаш звезда на наследството.')}</p>
        {runs.length > 0 && (
          <ul className="mt-3 divide-y divide-asphalt-800 text-sm">
            {runs.map((r) => <li key={r.id} className="py-2">{t('⭐ {0} · {1}: ниво {2}, {3} доставки, {4} км', r.star, date(r.createdAt), r.level, int(r.deliveries), int(r.totalKm))}</li>)}
          </ul>
        )}
      </Card>
      <Card title={t('Ново начало')}>
        {blockers.length ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-mist-300">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
        ) : (
          <NewCareerForm cities={cities.map((c) => ({ id: c.id, name: c.nameBg }))} />
        )}
      </Card>
    </div>
  );
}

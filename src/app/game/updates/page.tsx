import { ScrollText } from 'lucide-react';
import { ReleaseFold } from '@/components/game/ReleaseFold';
import { Card, Empty, PageHeader } from '@/components/ui';
import { visibleReleases } from '@/lib/game/releases';
import { testsUnreleased } from '@/server/auth/roles';
import { gameContext } from '@/server/game/context';
import { t, intlLocale } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Обновления') };
}

export default async function UpdatesPage() {
  await initLocale();
  const { user, now } = await gameContext();
  const staff = testsUnreleased(user);
  const releases = visibleReleases(now, staff);
  return (
    <div className="space-y-6">
      <PageHeader title={t('Обновления')} subtitle={t('Какво ново във всяка версия на TransVerse.')} />
      {releases.length === 0 ? (
        <Card><Empty icon={ScrollText} title={t('Още няма обновления')}>{t('Описанията ще се появяват тук.')}</Empty></Card>
      ) : (
        releases.map((r, i) => (
          <ReleaseFold key={r.version} release={r} heading={i === 0 ? 'h2' : 'h3'} className="panel p-5">
            {staff && new Date(r.publishedAt) > now && <p className="mb-3 rounded-xl border border-amber-sig/40 bg-amber-sig/10 px-3 py-2 text-sm text-amber-sig">{t('Предварителен преглед за персонала — играчите ще го видят от {0}.', new Date(r.publishedAt).toLocaleString(intlLocale(), { timeZone: 'Europe/Sofia' }))}</p>}
          </ReleaseFold>
        ))
      )}
    </div>
  );
}

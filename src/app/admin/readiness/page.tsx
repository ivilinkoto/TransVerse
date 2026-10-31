import type { Metadata } from 'next';
import { Badge, Card, PageHeader } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { adminContext } from '@/server/admin-context';
import { readiness } from '@/server/admin-1142';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Готовност за пускане') };
}
export const dynamic = 'force-dynamic';

/** 1.1.4.2: is the next update ready to go out — features, translations, notes. */
export default async function AdminReadiness() {
  await initLocale();
  const { db, now } = await adminContext();
  const r = await readiness(db, now);
  if (!r) return <PageHeader title={t('Готовност за пускане')} subtitle={t('Няма предстоящо обновление.')} />;
  const ok = (v: boolean) => (v ? <Badge tone="green">{t('готово')}</Badge> : <Badge tone="red">{t('липсва')}</Badge>);
  return (
    <div className="space-y-6">
      <PageHeader title={t('Готовност за пускане')} subtitle={t('{0} „{1}“ излиза {2} (след {3} ч).', r.release.version, tx(r.release.name), dateTime(new Date(r.release.publishedAt)), r.hoursLeft)} />
      <Card title={t('Проверки')}>
        <ul className="space-y-2 text-sm">
          <li className="flex items-center justify-between gap-2"><span>{t('Бележки към обновлението ({0} реда)', r.notes)}</span>{ok(r.notes > 0)}</li>
          <li className="flex items-center justify-between gap-2"><span>{t('Преводи на английски (липсват {0})', r.missing.en)}</span>{ok(r.missing.en === 0)}</li>
          <li className="flex items-center justify-between gap-2"><span>{t('Преводи на руски (липсват {0})', r.missing.ru)}</span>{ok(r.missing.ru === 0)}</li>
          <li className="flex items-center justify-between gap-2"><span>{t('Функции в обновлението ({0})', r.features.length)}</span>{ok(r.features.length > 0)}</li>
          <li className="flex items-center justify-between gap-2"><span>{t('Спрени от тях')}</span>{r.features.some((f) => f.off) ? <Badge tone="orange">{r.features.filter((f) => f.off).length}</Badge> : <Badge tone="green">0</Badge>}</li>
        </ul>
        <p className="mt-3 text-xs text-mist-400">{t('CI (тестове, e2e) се вижда в GitHub на PR-а — тук не се проверява.')}</p>
      </Card>
      <Card title={t('Функции')}>
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {r.features.map((f) => <li key={f.id} className="flex items-center justify-between gap-2 font-mono text-xs"><span>{f.id}</span>{f.off ? <Badge tone="red">{t('спряна')}</Badge> : <Badge tone="green">{t('готова')}</Badge>}</li>)}
        </ul>
        <p className="mt-3 text-xs text-mist-400">{t('Екипът ги вижда още сега; играчите — от часа на излизане.')}</p>
      </Card>
    </div>
  );
}

import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui';
import { adminContext } from '@/server/admin-context';
import { signupSources } from '@/server/admin-sources';
import { appUrl } from '@/server/discord/config';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Откъде идват играчите') };
}
export const dynamic = 'force-dynamic';

/** 1.2.4: sign-ups per `?src=` link (a Facebook post, a video…) and how many of them stayed. */
export default async function AdminSources() {
  await initLocale();
  const { db, now } = await adminContext({ admin: true });
  const rows = await signupSources(db, now);
  const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—');
  return (
    <div className="space-y-6">
      <PageHeader title={t('Откъде идват играчите')} subtitle={t('Сложи ?src= в линка на всяка публикация — например {0}/?src=fb-shipka. Регистрациите през него се броят тук.', appUrl())} />
      <Card title={t('Източници')}>
        {rows.length === 0 ? <p className="text-sm text-mist-400">{t('Още няма регистрации с ?src= в линка.')}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="sources">
              <thead><tr className="text-left text-xs text-mist-400"><th className="py-1.5">{t('Източник')}</th><th className="text-right">{t('Регистрации')}</th><th className="text-right">{t('За 30 дни')}</th><th className="text-right">{t('Активни (7 дни)')}</th><th className="text-right">{t('Ниво 3+')}</th><th className="text-right">{t('Платили')}</th></tr></thead>
              <tbody className="divide-y divide-asphalt-800">
                {rows.map((r) => (
                  <tr key={r.source}>
                    <td className="py-1.5 font-mono text-xs">{r.source}</td>
                    <td className="num text-right">{r.signups}</td>
                    <td className="num text-right">{r.last30}</td>
                    <td className="num text-right">{r.active} <span className="text-xs text-mist-400">{pct(r.active, r.signups)}</span></td>
                    <td className="num text-right">{r.level3} <span className="text-xs text-mist-400">{pct(r.level3, r.signups)}</span></td>
                    <td className="num text-right">{r.paying}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-mist-400">{t('Брои се първият линк, с който човекът е влязъл (30 дни). Споделените курсове идват като „trip-share“.')}</p>
      </Card>
    </div>
  );
}

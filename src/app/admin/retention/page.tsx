import Link from 'next/link';
import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { date, dateTime, int } from '@/lib/format';
import { adminContext } from '@/server/admin-context';
import { dailyActivity, missingPlayers, retentionCohorts, WIN_BACK_COINS } from '@/server/admin-retention';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Задържане') };
}
export const dynamic = 'force-dynamic';

const pct = (part: number | null, size: number) => (part == null ? '—' : size ? `${Math.round((part / size) * 100)}%` : '0%');

/** 1.1.4.1: do players come back? Cohorts, the last two weeks, and who stopped coming. */
export default async function AdminRetention() {
  await initLocale();
  const { db, now } = await adminContext();
  const [cohorts, days, missing] = await Promise.all([retentionCohorts(db, now), dailyActivity(db, now), missingPlayers(db, now)]);
  const peak = Math.max(1, ...days.map((d) => d.active));
  return (
    <div className="space-y-6">
      <PageHeader title={t('Задържане')} subtitle={t('Връщат ли се играчите. Само играчи, без екипа.')} />
      <Card title={t('По седмица на регистрация')} className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead className="text-left text-xs text-mist-400">
            <tr><th className="py-1.5">{t('Седмица')}</th><th>{t('Нови')}</th><th>{t('Върнали се след 1 ден')}</th><th>{t('след 7 дни')}</th><th>{t('след 30 дни')}</th></tr>
          </thead>
          <tbody className="divide-y divide-asphalt-800">
            {cohorts.map((c) => (
              <tr key={c.week}>
                <td className="py-1.5">{date(new Date(`${c.week}T12:00:00Z`))}</td>
                <td className="num">{int(c.size)}</td>
                <td className="num">{pct(c.d1, c.size)}</td>
                <td className="num">{pct(c.d7, c.size)}</td>
                <td className="num">{pct(c.d30, c.size)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-mist-400">{t('„—“: седмицата е още твърде нова за този ден.')}</p>
      </Card>
      <Card title={t('Последните 14 дни')} className="overflow-x-auto">
        <div className="flex min-w-[480px] items-end gap-1.5" style={{ height: 140 }}>
          {days.map((d) => (
            <div key={d.day} className="flex flex-1 flex-col items-center justify-end gap-1" title={t('{0}: {1} в играта, {2} нови, {3} курса', d.day, d.active, d.signups, d.trips)}>
              <span className="num text-[10px] text-mist-400">{d.active}</span>
              <div className="w-full rounded-t bg-cyan-glow/70" style={{ height: `${Math.max(2, (d.active / peak) * 100)}px` }} />
              <span className="text-[10px] text-mist-500">{d.day.slice(8)}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-mist-400">{t('Играчи с действие в играта на ден. Задръж мишката за нови и курсове.')}</p>
      </Card>
      <Card title={t('Изчезнали ({0})', missing.length)}>
        <p className="mb-2 text-xs text-mist-400">{t('Не са влизали от 3 до 30 дни. „Покани обратно“: известие, имейл (ако е потвърден) и {0} ТрансКоин — веднъж в месеца.', WIN_BACK_COINS)}</p>
        {missing.length === 0 ? <p className="text-sm text-mist-400">{t('Няма такива.')}</p> : (
          <ul className="divide-y divide-asphalt-800 text-sm">
            {missing.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <Link href={`/admin/users/${m.id}`} className="font-semibold hover:underline">{tx(m.username)}</Link>
                  <span className="text-xs text-mist-400"> · {t('ниво {0}', m.level)} · {t('{0} курса', m.deliveries ?? 0)} · {t('последно {0}', m.lastSeenAt ? dateTime(m.lastSeenAt) : '—')}</span>
                </span>
                <ActionButton endpoint="/api/admin/action" action={{ type: 'winBack', userId: m.id }} className="btn-ghost px-2.5 py-1 text-xs">{t('Покани обратно')}</ActionButton>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

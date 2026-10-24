import { sql } from 'drizzle-orm';
import { CheckCircle2, XCircle } from 'lucide-react';
import { DiscordCheck } from '@/components/admin/DiscordCheck';
import { DiscordLayout } from '@/components/admin/DiscordLayout';
import { DiscordSwitches } from '@/components/admin/DiscordSwitches';
import { layoutState } from '@/server/discord/layout';
import { Badge, Card, PageHeader } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { adminContext } from '@/server/admin-context';
import { jobHealth } from '@/server/game/world';
import { pushDevices } from '@/server/push';
import { t as tr, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Система и известия') };
}
export const dynamic = 'force-dynamic';

const at = (t: number | Date | null | undefined) => (t ? dateTime(t) : '—');

/** Worker health (every job's last success and error) and the phones that get notifications. */
export default async function AdminSystem() {
  await initLocale();
  const { db, now } = await adminContext();
  const [jobs, devices, cursor] = await Promise.all([
    jobHealth(db),
    pushDevices(db),
    db.execute<{ cursor: number | null; newest: number | null }>(sql`select (select (value->>'id')::bigint from job_state where key = 'push-cursor') as cursor, (select max(id) from notifications) as newest`),
  ]);
  const { cursor: pushed, newest } = cursor.rows[0] ?? { cursor: null, newest: null };
  const lag = pushed != null && newest != null ? Number(newest) - Number(pushed) : null;
  const stale = jobs.filter((j) => j.failures > 0);
  const discordSettings = (await layoutState(db)).settings;
  return (
    <div className="space-y-6">
      <PageHeader title={tr('Система и известия')} subtitle={tr('Задачите на фоновия процес (worker) и устройствата с включени известия.')} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title={tr('Фонов процес')}>
          <p className="mb-3 text-sm text-mist-400">{tr('Всяка задача се изпълнява отделно: ако една гърми, останалите продължават. Тук се вижда последната грешка.')}</p>
          {jobs.length === 0 ? <p className="text-sm text-mist-400">{tr('Още няма данни — фоновият процес не е стартирал с тази версия.')}</p> : (
            <ul className="divide-y divide-asphalt-800 text-sm">
              {jobs.map((j) => (
                <li key={j.key} className="py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-mono text-xs">
                      {j.failures > 0 ? <XCircle className="h-4 w-4 text-loss" /> : <CheckCircle2 className="h-4 w-4 text-profit" />}
                      {tx(j.key)}
                    </span>
                    <span className="text-xs text-mist-400">{tr('успех: {0}', at(j.okAt))}</span>
                  </div>
                  {j.failures > 0 && j.error && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-loss">{tr('Грешка {0} · {1} пъти подред', at(j.errorAt), j.failures)}</summary>
                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-asphalt-950 p-2 text-[11px] text-mist-300">{tx(j.error)}</pre>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
          {stale.length > 0 && <p className="mt-3 text-sm text-loss">{tr('{0} задачи гърмят в момента.', stale.length)}</p>}
        </Card>
        <Card title={tr('Известия към телефоните')}>
          <ul className="space-y-1.5 text-sm">
            <li>{tr('Последно изпратено известие №:')}{' '}<span className="num">{pushed ?? '—'}</span></li>
            <li>{tr('Най-новото известие в играта №:')}{' '}<span className="num">{newest ?? '—'}</span></li>
            <li>{tr('Изостават:')}{' '}{lag == null ? '—' : lag <= 50 ? <Badge tone="green">{lag}</Badge> : <Badge tone="red">{lag}</Badge>}</li>
          </ul>
          <p className="mt-3 text-sm text-mist-400">{tr('Ако „изостават“ расте, фоновият процес не стига до изпращането — виж грешките вляво.')}</p>
        </Card>
      </div>
      <Card title={tr('Discord бот')}>
        <p className="mb-3 text-sm text-mist-400">{tr('Проверява на живо всичко, което ботът трябва да има: тайните, настройките в Developer Portal, правата в сървъра, каналите и връзката на фоновия процес.')}</p>
        <DiscordCheck />
      </Card>
      <Card title={tr('Подреждане на Discord сървъра')}>
        <p className="mb-3 text-sm text-mist-400">{tr('Категории и канали с емоджита, теми и права: добре дошли, новини, общност, поддръжка с тикети, статистика, гласови, екип, компании. Първо виж плана — после „Приложи“.')}</p>
        <DiscordLayout />
      </Card>
      <Card title={tr('Защита на Discord сървъра')}>
        <DiscordSwitches automod={discordSettings?.automod !== false} verification={!!discordSettings?.verification} />
      </Card>
      <Card title={tr('Устройства ({0})', devices.length)} className="p-2 sm:p-3">
        {devices.length === 0 ? <p className="p-3 text-sm text-mist-400">{tr('Никой още не е включил известия.')}</p> : (
          <ul className="divide-y divide-asphalt-800">
            {devices.map((d) => (
              <li key={d.id} className="px-2 py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{tx(d.username)}</span>
                  {d.lastError && (!d.lastSuccessAt || (d.lastErrorAt && d.lastErrorAt > d.lastSuccessAt)) ? <Badge tone="red">{tr('грешка')}</Badge> : d.lastSuccessAt ? <Badge tone="green">{tr('работи')}</Badge> : <Badge>{tr('още не е пращано')}</Badge>}
                  {d.quiet && <Badge>{tr('тихи часове {0}–{1} ч', d.quiet.from, d.quiet.to)}</Badge>}
                  <span className="text-xs text-mist-400">{tr('включено {0} · успех {1}', at(d.createdAt), at(d.lastSuccessAt))}</span>
                </div>
                <div className="mt-0.5 truncate text-xs text-mist-400">{d.userAgent ?? tr('неизвестно устройство')}</div>
                {d.lastError && <div className="mt-0.5 break-all text-xs text-loss">{at(d.lastErrorAt)}: {tx(d.lastError)}</div>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-xs text-mist-400">{tr('Към {0}', at(now))}</p>
    </div>
  );
}

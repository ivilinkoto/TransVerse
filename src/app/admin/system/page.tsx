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
import { groupServerErrors, recentServerErrors } from '@/server/error-log';
import { failedOutbox, MAX_ATTEMPTS } from '@/server/discord/outbox';
import { ActionButton } from '@/components/ui/ActionButton';
import { disabledFeatures } from '@/server/feature-switches';
import { FEATURES, featureLive, type FeatureId } from '@/lib/game/features';
import { compareVersions } from '@/lib/game/releases';
import { BACKUP, backupDir, lastBackup } from '@/server/backup';
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
export default async function AdminSystem({ searchParams }: { searchParams: Promise<{ errors?: string }> }) {
  await initLocale();
  const { db, now } = await adminContext();
  const filter = ((await searchParams).errors ?? '').trim().slice(0, 80).toLowerCase();
  const [jobs, devices, cursor, errors, backup, undelivered] = await Promise.all([
    jobHealth(db),
    pushDevices(db),
    db.execute<{ cursor: number | null; newest: number | null }>(sql`select (select (value->>'id')::bigint from job_state where key = 'push-cursor') as cursor, (select max(id) from notifications) as newest`),
    recentServerErrors(db),
    lastBackup(db),
    failedOutbox(db),
  ]);
  // 1.1.4.1: the newest features, and every switched-off one, can be turned off for the players.
  const off = await disabledFeatures(db, true);
  const switchable = (Object.keys(FEATURES) as FeatureId[]).filter((id) => off.has(id) || (compareVersions(FEATURES[id], '1.1.3') >= 0 && featureLive(id, now))).sort((a, b) => compareVersions(FEATURES[b], FEATURES[a]));
  // 1.1.3.5: the same error on the same page once, with how many times; a filter by page or text.
  const grouped = groupServerErrors(errors).filter((e) => !filter || e.where.toLowerCase().includes(filter) || e.message.toLowerCase().includes(filter) || e.digests.some((d) => d.toLowerCase().includes(filter)));
  const lastHour = errors.filter((e) => now.getTime() - new Date(e.at).getTime() < 3_600_000).length;
  const backupFolder = backupDir();
  const { cursor: pushed, newest } = cursor.rows[0] ?? { cursor: null, newest: null };
  const lag = pushed != null && newest != null ? Number(newest) - Number(pushed) : null;
  const stale = jobs.filter((j) => j.failures > 0);
  const discordSettings = (await layoutState(db)).settings;
  return (
    <div className="space-y-6">
      <PageHeader title={tr('Система и известия')} subtitle={tr('Задачите на фоновия процес (worker) и устройствата с включени известия.')} />
      <div className="grid gap-6 xl:grid-cols-2">
        {/* 1.1.4: the nightly copy of the database and the last unexpected errors. */}
        <Card title={tr('Резервно копие на базата')} actions={backup ? <Badge tone={backup.ok ? 'green' : 'red'}>{backup.ok ? tr('наред') : tr('грешка')}</Badge> : undefined}>
          {!backupFolder ? (
            <p className="text-sm text-mist-400">{tr('Не се прави тук: няма папка за копия (BACKUP_DIR или /var/www/transverse/shared). На сървъра от deploy се прави само.')}</p>
          ) : !backup ? (
            <p className="text-sm text-mist-400">{tr('Още няма копие — прави се всяка нощ около 03:00 в {0}.', backupFolder)}</p>
          ) : (
            <div className="space-y-1 text-sm">
              <p>{tr('Последно: {0}', at(new Date(backup.at)))}{backup.bytes ? tr(' · {0} MB', (backup.bytes / 1_048_576).toFixed(1)) : ''}</p>
              {backup.file && <p className="break-all font-mono text-xs text-mist-400">{tx(backup.file)}</p>}
              {backup.error && <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-asphalt-950 p-2 text-[11px] text-loss">{tx(backup.error)}</pre>}
              <p className="text-xs text-mist-400">{tr('Пазят се последните {0} копия. Копие извън сървъра: виж docs/DEPLOYMENT.md → „Архивиране“.', BACKUP.keep)}</p>
            </div>
          )}
        </Card>
        <Card title={tr('Грешки на сървъра ({0})', errors.length)} actions={errors.length ? <ActionButton action={{ type: 'clearServerErrors' }} endpoint="/api/admin/action" className="btn-ghost px-2.5 py-1 text-xs" confirm={tr('Списъкът с грешки се изчиства. Продължаваш ли?')}>{tr('Изчисти')}</ActionButton> : undefined}>
          {errors.length === 0 ? <p className="text-sm text-mist-400">{tr('Няма неочаквани грешки.')}</p> : (
            <>
              <form className="mb-2 flex gap-2" action="/admin/system">
                <input name="errors" defaultValue={filter} className="input py-1.5 text-sm" placeholder={tr('Филтър: страница, текст или код')} aria-label={tr('Филтър на грешките')} />
                <button className="btn-ghost px-3 py-1 text-xs">{tr('Филтрирай')}</button>
              </form>
              <p className="mb-2 text-xs text-mist-400">{tr('{0} различни · {1} за последния час', grouped.length, lastHour)}</p>
              <ul className="max-h-80 space-y-1.5 overflow-auto text-sm">
                {grouped.map((e, i) => (
                  <li key={i}>
                    <div className="flex justify-between gap-3"><span className="font-mono text-xs">{tx(e.where)}{e.count > 1 && <>{" "}<Badge tone="red">×{e.count}</Badge></>}</span><span className="shrink-0 text-xs text-mist-400">{at(new Date(e.at))}</span></div>
                    <div className="break-words text-xs text-loss">{tx(e.message)}</div>
                    {(e.count > 1 || e.digests.length > 0) && <div className="text-[11px] text-mist-500">{e.count > 1 ? tr('първа: {0}', at(new Date(e.firstAt))) : ''}{e.digests.length ? `${e.count > 1 ? ' · ' : ''}${tr('код: {0}', e.digests.join(', '))}` : ''}</div>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
        <Card title={tr('Неуспешни към Discord ({0})', undelivered.length)}>
          {undelivered.length === 0 ? <p className="text-sm text-mist-400">{tr('Всичко стигна до Discord.')}</p> : (
            <ul className="max-h-80 space-y-2 overflow-auto text-sm">
              {undelivered.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs">{tx(r.target)}</span>{r.gaveUp ? <Badge tone="red">{tr('отказано')}</Badge> : <Badge tone="gold">{tr('опит {0}/{1}', r.attempts, MAX_ATTEMPTS)}</Badge>}<span className="text-xs text-mist-400">{at(r.createdAt)}</span></div>
                    <div className="truncate font-mono text-[11px] text-mist-500">{tx(r.dedupeKey)}</div>
                    <div className="break-words text-xs text-loss">{tx(r.lastError ?? '')}</div>
                  </div>
                  <ActionButton action={{ type: 'discordRetry', id: r.id }} endpoint="/api/admin/action" className="btn-ghost px-2.5 py-1 text-xs">{tr('Прати пак')}</ActionButton>
                </li>
              ))}
            </ul>
          )}
        </Card>
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
      <Card title={tr('Функции — изключване при проблем ({0} спрени)', off.size)}>
        <p className="mb-3 text-sm text-mist-400">{tr('Спира функция за играчите (меню, страници, команди) без нов деплой. Екипът я вижда, за да тества поправката. Фоновите задачи не се спират.')}</p>
        <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
          {switchable.map((id) => (
            <li key={id} className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 ${off.has(id) ? 'border-loss/50 bg-loss/10' : 'border-asphalt-700'}`}>
              <span className="min-w-0 truncate font-mono text-xs">{id} <span className="text-mist-500">· {FEATURES[id]}</span></span>
              <ActionButton action={{ type: 'featureSwitch', feature: id, off: !off.has(id) }} endpoint="/api/admin/action" className="btn-ghost px-2 py-0.5 text-[11px]" confirm={off.has(id) ? undefined : tr('Функцията спира за всички играчи. Продължаваш ли?')}>{off.has(id) ? tr('Включи') : tr('Спри')}</ActionButton>
            </li>
          ))}
        </ul>
      </Card>
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

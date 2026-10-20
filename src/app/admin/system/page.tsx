import { sql } from 'drizzle-orm';
import { CheckCircle2, XCircle } from 'lucide-react';
import { DiscordCheck } from '@/components/admin/DiscordCheck';
import { DiscordLayout } from '@/components/admin/DiscordLayout';
import { Badge, Card, PageHeader } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { adminContext } from '@/server/admin-context';
import { jobHealth } from '@/server/game/world';
import { pushDevices } from '@/server/push';

export const metadata = { title: 'Система и известия' };
export const dynamic = 'force-dynamic';

const at = (t: number | Date | null | undefined) => (t ? dateTime(t) : '—');

/** Worker health (every job's last success and error) and the phones that get notifications. */
export default async function AdminSystem() {
  const { db, now } = await adminContext();
  const [jobs, devices, cursor] = await Promise.all([
    jobHealth(db),
    pushDevices(db),
    db.execute<{ cursor: number | null; newest: number | null }>(sql`select (select (value->>'id')::bigint from job_state where key = 'push-cursor') as cursor, (select max(id) from notifications) as newest`),
  ]);
  const { cursor: pushed, newest } = cursor.rows[0] ?? { cursor: null, newest: null };
  const lag = pushed != null && newest != null ? Number(newest) - Number(pushed) : null;
  const stale = jobs.filter((j) => j.failures > 0);
  return (
    <div className="space-y-6">
      <PageHeader title="Система и известия" subtitle="Задачите на фоновия процес (worker) и устройствата с включени известия." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Фонов процес">
          <p className="mb-3 text-sm text-mist-400">Всяка задача се изпълнява отделно: ако една гърми, останалите продължават. Тук се вижда последната грешка.</p>
          {jobs.length === 0 ? <p className="text-sm text-mist-400">Още няма данни — фоновият процес не е стартирал с тази версия.</p> : (
            <ul className="divide-y divide-asphalt-800 text-sm">
              {jobs.map((j) => (
                <li key={j.key} className="py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-mono text-xs">
                      {j.failures > 0 ? <XCircle className="h-4 w-4 text-loss" /> : <CheckCircle2 className="h-4 w-4 text-profit" />}
                      {j.key}
                    </span>
                    <span className="text-xs text-mist-400">успех: {at(j.okAt)}</span>
                  </div>
                  {j.failures > 0 && j.error && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-loss">Грешка {at(j.errorAt)} · {j.failures} пъти подред</summary>
                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-asphalt-950 p-2 text-[11px] text-mist-300">{j.error}</pre>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
          {stale.length > 0 && <p className="mt-3 text-sm text-loss">{stale.length} задачи гърмят в момента.</p>}
        </Card>
        <Card title="Известия към телефоните">
          <ul className="space-y-1.5 text-sm">
            <li>Последно изпратено известие №: <span className="num">{pushed ?? '—'}</span></li>
            <li>Най-новото известие в играта №: <span className="num">{newest ?? '—'}</span></li>
            <li>Изостават: {lag == null ? '—' : lag <= 50 ? <Badge tone="green">{lag}</Badge> : <Badge tone="red">{lag}</Badge>}</li>
          </ul>
          <p className="mt-3 text-sm text-mist-400">Ако „изостават“ расте, фоновият процес не стига до изпращането — виж грешките вляво.</p>
        </Card>
      </div>
      <Card title="Discord бот">
        <p className="mb-3 text-sm text-mist-400">Проверява на живо всичко, което ботът трябва да има: тайните, настройките в Developer Portal, правата в сървъра, каналите и връзката на фоновия процес.</p>
        <DiscordCheck />
      </Card>
      <Card title="Подреждане на Discord сървъра">
        <p className="mb-3 text-sm text-mist-400">Категории и канали с емоджита, теми и права: добре дошли, новини, общност, поддръжка с тикети, статистика, гласови, екип, компании. Първо виж плана — после „Приложи“.</p>
        <DiscordLayout />
      </Card>
      <Card title={`Устройства (${devices.length})`} className="p-2 sm:p-3">
        {devices.length === 0 ? <p className="p-3 text-sm text-mist-400">Никой още не е включил известия.</p> : (
          <ul className="divide-y divide-asphalt-800">
            {devices.map((d) => (
              <li key={d.id} className="px-2 py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{d.username}</span>
                  {d.lastError && (!d.lastSuccessAt || (d.lastErrorAt && d.lastErrorAt > d.lastSuccessAt)) ? <Badge tone="red">грешка</Badge> : d.lastSuccessAt ? <Badge tone="green">работи</Badge> : <Badge>още не е пращано</Badge>}
                  {d.quiet && <Badge>тихи часове {d.quiet.from}–{d.quiet.to} ч</Badge>}
                  <span className="text-xs text-mist-400">включено {at(d.createdAt)} · успех {at(d.lastSuccessAt)}</span>
                </div>
                <div className="mt-0.5 truncate text-xs text-mist-400">{d.userAgent ?? 'неизвестно устройство'}</div>
                {d.lastError && <div className="mt-0.5 break-all text-xs text-loss">{at(d.lastErrorAt)}: {d.lastError}</div>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-xs text-mist-400">Към {at(now)}</p>
    </div>
  );
}

import { XCircle } from 'lucide-react';
import { EventForm } from '@/components/admin/EventForm';
import { Badge, Card, PageHeader, Table } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { dateTime, int } from '@/lib/format';
import { CARGO } from '@/lib/game/cargo';
import { DEFAULT_REWARDS, EVENT_METRIC_INFO, EVENT_METRICS, EVENT_TEMPLATES, eventStatus, formatAmount, type EventMetric } from '@/lib/game/events';
import { isAdmin } from '@/server/auth/roles';
import { countries } from '@/server/db/schema';
import { adminContext } from '@/server/admin-context';
import { adminEvents } from '@/server/game/events';

export const metadata = { title: 'Ивенти' };

const STATUS: Record<string, { label: string; tone: 'cyan' | 'green' | 'gold' | 'red' | 'neutral' }> = {
  scheduled: { label: 'предстои', tone: 'cyan' },
  active: { label: 'тече', tone: 'green' },
  ending: { label: 'приключва', tone: 'gold' },
  success: { label: 'успешен', tone: 'green' },
  failed: { label: 'неуспешен', tone: 'red' },
  cancelled: { label: 'отменен', tone: 'neutral' },
};

export default async function AdminEventsPage() {
  const { db, user, now } = await adminContext();
  const [rows, countryRows] = await Promise.all([adminEvents(db), db.select({ code: countries.code, name: countries.nameBg }).from(countries).orderBy(countries.nameBg)]);
  const admin = isAdmin(user.role);
  const eur = (cents: number) => Math.round(cents / 100);
  return (
    <div className="space-y-6">
      <PageHeader title="Ивенти" subtitle="Общи цели за всички играчи с краен срок. Системата пуска автоматичен ивент на всеки няколко дни (72 часа, от 18:00 ч.); тук можеш да създадеш и свой — с име, цел, период и награди. Наградите се раздават само ако целта бъде постигната." />
      {admin ? (
        <Card title="Нов ивент">
          <EventForm
            metrics={EVENT_METRICS.map((m) => ({ id: m, label: EVENT_METRIC_INFO[m].label, unit: EVENT_METRIC_INFO[m].unit, minContribution: EVENT_METRIC_INFO[m].minContribution }))}
            cargoTypes={Object.values(CARGO).map((c) => ({ id: c.id, label: c.label }))}
            countries={countryRows}
            templates={EVENT_TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, metric: t.metric, cargoType: t.cargoType ?? null, countryCode: t.countryCode ?? null }))}
            defaults={{ participant: { eur: eur(DEFAULT_REWARDS.participant.cents), xp: DEFAULT_REWARDS.participant.xp, coins: DEFAULT_REWARDS.participant.coins }, top: DEFAULT_REWARDS.top.map((t) => ({ eur: eur(t.cents), xp: t.xp, coins: t.coins, vipDays: t.vipDays })) }}
          />
        </Card>
      ) : (
        <Card><p className="text-sm text-mist-400">Ивенти се създават от администратор.</p></Card>
      )}
      <Card title="Всички ивенти">
        <Table head={['Ивент', 'Период', 'Напредък', 'Участници', 'Създаден от', 'Състояние', '']}>
          {rows.map(({ event: e, contributors, creator }) => {
            const s = STATUS[eventStatus(e, now)]!;
            return (
              <tr key={e.id}>
                <td className="px-3 py-2 font-semibold">{e.name}</td>
                <td className="px-3 py-2 text-mist-400">{dateTime(e.startsAt)} – {dateTime(e.endsAt)}</td>
                <td className="num px-3 py-2">{formatAmount(e.metric as EventMetric, e.progress)} / {formatAmount(e.metric as EventMetric, e.target)}</td>
                <td className="num px-3 py-2">{int(contributors)}</td>
                <td className="px-3 py-2 text-mist-400">{creator ?? 'автоматично'}</td>
                <td className="px-3 py-2"><Badge tone={s.tone}>{s.label}</Badge></td>
                <td className="px-3 py-2">
                  {admin && !e.settledAt && (
                    <ActionButton endpoint="/api/admin/action" action={{ type: 'cancelEvent', eventId: e.id }} className="btn-ghost px-3 py-1.5 text-xs" confirm={`Да отменим ли „${e.name}“? Наградите няма да бъдат раздадени.`}>
                      <XCircle className="h-3.5 w-3.5" />Отмени
                    </ActionButton>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
        {rows.length === 0 && <p className="mt-3 text-sm text-mist-400">Все още няма ивенти. Първият автоматичен ще бъде създаден от фоновия процес.</p>}
      </Card>
    </div>
  );
}

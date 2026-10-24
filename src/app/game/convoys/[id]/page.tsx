import { and, eq, gt, inArray } from 'drizzle-orm';
import { ArrowRight, Radio } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { dateTime, money } from '@/lib/format';
import { CARGO, type CargoType } from '@/lib/game/cargo';
import { ACCESS_LABELS, columnShare, CONVOYS, CONVOY_ROLES, type ConvoyAccess, type ConvoyRole } from '@/lib/game/convoys';
import { REPORT_KINDS, type ReportKind } from '@/lib/game/live-road';
import { cities, roadReports } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { convoyDetail, laneLoads } from '@/server/game/convoys';
import { fleetView } from '@/server/game/queries';
import { ConvoyChat, JoinConvoy } from '../ConvoyForms';

export const metadata = { title: 'Конвой' };

export default async function ConvoyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { db, user, company, now, features } = await gameContext();
  if (!features.convoy_lobby) notFound();
  const c = await convoyDetail(db, user.id, id);
  if (!c) notFound();
  const open = c.status === 'open';
  const fleet = open && !c.mine ? await fleetView(db, company.id) : null;
  const vehicles = (fleet?.vehicles ?? []).filter((v) => v.city.id === c.originCityId && v.status === 'idle').map((v) => ({ id: v.id, label: `${v.plate} · ${v.model.name}` }));
  const loads = open && !c.mine ? await laneLoads(db, c, now) : [];
  const freeRoles = (['tail', 'scout'] as const).filter((r) => !c.members.some((m) => m.role === r && m.status === 'ready'));
  const leading = c.leaderId === user.id;
  // The scout sees the road reports on the lane.
  const scout = c.mine?.role === 'scout' || leading;
  const ends = scout ? await db.select({ id: cities.id, lat: cities.lat, lon: cities.lon }).from(cities).where(inArray(cities.id, [c.originCityId, c.destCityId])) : [];
  const reports = scout && ends.length === 2 ? (await db.select({ kind: roadReports.kind, near: roadReports.near, lat: roadReports.lat, lon: roadReports.lon }).from(roadReports).where(and(gt(roadReports.expiresAt, now), eq(roadReports.settled, false)))).filter((r) => r.lat >= Math.min(ends[0]!.lat, ends[1]!.lat) - 0.3 && r.lat <= Math.max(ends[0]!.lat, ends[1]!.lat) + 0.3 && r.lon >= Math.min(ends[0]!.lon, ends[1]!.lon) - 0.3 && r.lon <= Math.max(ends[0]!.lon, ends[1]!.lon) + 0.3) : [];
  const ready = c.members.filter((m) => m.status === 'ready' || m.status === 'departed');

  return (
    <div className="space-y-6">
      <PageHeader
        title={c.title ?? 'Конвой'}
        subtitle={`${c.from} → ${c.to} · ${c.kind === 'official' ? 'неделният конвой на TransVerse' : c.kind === 'company' ? `фирмен конвой на „${c.company ?? ''}“` : `води ${c.leader ?? '—'} · ${ACCESS_LABELS[c.access as ConvoyAccess]}`}`}
        actions={<Link href="/game/convoys" className="btn-ghost">← Всички конвои</Link>}
      />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Card title="Колоната" actions={<Badge tone={open ? 'cyan' : c.status === 'cancelled' ? 'red' : 'green'}>{open ? `тръгва ${dateTime(c.departAt)}` : c.status === 'departed' ? `на път · пристига ${c.arrivesAt ? dateTime(c.arrivesAt) : ''}` : c.status === 'arrived' ? 'пристигна' : 'отменен'}</Badge>}>
            <div className="mb-3 inline-flex flex-wrap items-center gap-1.5 text-sm"><span className="font-semibold">{c.from}</span><ArrowRight className="h-3.5 w-3.5 text-mist-400" /><span className="font-semibold">{c.to}</span><span className="text-mist-400">· {ready.length} / {c.seats} камиона{c.minLevel > 1 ? ` · от ниво ${c.minLevel}` : ''}</span></div>
            <ul className="divide-y divide-asphalt-800 text-sm">
              {c.members.map((m) => (
                <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{CONVOY_ROLES[m.role as ConvoyRole].emoji} <span className="font-medium">{m.username}</span> <span className="text-xs text-mist-400">· {m.plate ?? ''} · {CONVOY_ROLES[m.role as ConvoyRole].label}</span></span>
                  {m.status === 'dropped' ? <span title={m.reason ?? ''}><Badge tone="red">не тръгна</Badge></span> : m.status === 'left' ? <Badge tone="neutral">излезе</Badge> : m.status === 'departed' ? <Badge tone="green">на път</Badge> : <Badge tone="cyan">готов</Badge>}
                </li>
              ))}
              {c.members.length === 0 && <li className="py-2 text-mist-400">Още няма камиони.</li>}
            </ul>
            {c.sharedCargo && <p className="mt-3 text-xs text-violet-300">Общ товар: {CARGO[c.sharedCargo as CargoType]?.label} · {c.sharedTons} т на камион, платен ×{CONVOYS.sharedMultiplier}.</p>}
            <p className="mt-2 text-xs text-mist-400">Сега при пристигане навреме: +{Math.round(columnShare(Math.max(ready.length, CONVOYS.minTrucks)) * 100)} % за колоната, +{Math.round(CONVOYS.allOnTimeShare * 100)} % ако всички са навреме{c.kind === 'company' ? ', без вноска към касата и ×1,5 фирмен опит' : ''}.</p>
          </Card>
          {open && !c.mine && (
            <Card title="Включи се">
              <JoinConvoy convoyId={c.id} vehicles={vehicles} loads={loads.map((l) => ({ id: l.id, label: `${l.goods} · ${l.weightTons} т · ${money(l.rewardCents)}` }))} shared={c.sharedCargo ? `${CARGO[c.sharedCargo as CargoType]?.label} ${c.sharedTons} т` : null} roles={[...freeRoles]} />
              <p className="mt-2 text-xs text-mist-400">Камионът трябва да е в {c.from} и свободен в часа на тръгване. Неготовите остават.</p>
            </Card>
          )}
          {open && (c.mine || leading) && (
            <div className="flex flex-wrap gap-2">
              {c.mine && !leading && <ActionButton action={{ type: 'leaveConvoy', convoyId: c.id }} className="btn-ghost">Излез от конвоя</ActionButton>}
              {leading && <ActionButton action={{ type: 'cancelConvoy', convoyId: c.id }} confirm="Да отменим ли конвоя? Всички товари се освобождават." className="btn-ghost">Отмени конвоя</ActionButton>}
            </div>
          )}
        </div>
        <div className="space-y-6">
          {(c.mine || leading) && (
            <Card title="Разговор в колоната">
              <ul className="mb-3 max-h-72 space-y-1 overflow-y-auto text-sm">
                {c.messages.map((m) => <li key={m.id}><span className="font-medium">{m.username}:</span> <span className="break-words text-mist-200">{m.body}</span></li>)}
                {c.messages.length === 0 && <li className="text-mist-400">Кажи здрасти на колоната.</li>}
              </ul>
              <ConvoyChat convoyId={c.id} />
            </Card>
          )}
          {scout && (
            <Card title={<span className="inline-flex items-center gap-2"><Radio className="h-4 w-4 text-mist-400" />Сигнали по линията</span>}>
              {reports.length === 0 ? <p className="text-sm text-mist-400">Няма активни сигнали.</p> : <ul className="space-y-1 text-sm">{reports.map((r, i) => <li key={i}>{REPORT_KINDS[r.kind as ReportKind]?.emoji ?? '⚠️'} {REPORT_KINDS[r.kind as ReportKind]?.label ?? r.kind} · {r.near}</li>)}</ul>}
            </Card>
          )}
          {c.byCompany.length > 0 && (
            <Card title="Компаниите в колоната">
              <ol className="space-y-1 text-sm">{c.byCompany.map((o, i) => <li key={o.name} className="flex justify-between"><span>{i + 1}. {o.name}</span><span className="num">{o.trucks} камиона</span></li>)}</ol>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

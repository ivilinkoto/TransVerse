import { Hint } from '@/components/game/Hint';
import { BarChart3, Clock, Fuel, Route, TrendingUp, Truck } from 'lucide-react';
import { Card, Empty, PageHeader, Segmented, Stat } from '@/components/ui';
import { dec, int, km, money } from '@/lib/format';
import { CARGO, type CargoType } from '@/lib/game/cargo';
import { powerUnitModel } from '@/lib/game/catalog';
import type { Group } from '@/lib/game/analytics';
import { companyAnalytics } from '@/server/game/analytics';
import { gameContext } from '@/server/game/context';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Анализ') };
}

const PERIODS = [7, 30, 90] as const;

/** Daily net result as bars (green above zero, red below). */
function NetChart({ days }: { days: { day: string; netCents: number; trips: number }[] }) {
  const W = 640;
  const H = 170;
  const pad = 30;
  const max = Math.max(1, ...days.map((d) => Math.abs(d.netCents)));
  const zero = H / 2 + (days.some((d) => d.netCents < 0) ? 0 : H / 2 - 22);
  const scale = (zero - 10) / max;
  const step = (W - pad) / days.length;
  const bw = Math.max(2, Math.min(22, step * 0.62));
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full min-w-[420px]" role="img" aria-label={t('Нетен резултат по дни')}>
        <line x1={pad} x2={W} y1={zero} y2={zero} stroke="var(--color-asphalt-600)" />
        <text x={0} y={14} fontSize="10" fill="var(--color-mist-400)">{money(max).replace(/\s?лв\.$/, '')}</text>
        {days.map((d, i) => {
          const x = pad + i * step + step / 2;
          const h = Math.abs(d.netCents) * scale;
          return (
            <g key={d.day}>
              <title>{t('{0}: {1} · {2} курса', d.day, money(d.netCents), d.trips)}</title>
              <rect x={x - bw / 2} y={d.netCents >= 0 ? zero - h : zero} width={bw} height={Math.max(1, h)} rx={2} fill={d.netCents >= 0 ? 'var(--color-profit)' : 'var(--color-loss)'} />
              {(days.length <= 31 ? i % Math.ceil(days.length / 10) === 0 : i % 9 === 0) && (
                <text x={x} y={H - 4} fontSize="10" textAnchor="middle" fill="var(--color-mist-400)">{d.day.slice(8)}.{d.day.slice(5, 7)}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** A ranking with a bar for each row's net result. */
function Ranking({ rows, name, sub }: { rows: Group[]; name: (g: Group) => React.ReactNode; sub?: (g: Group) => React.ReactNode }) {
  if (!rows.length) return <p className="text-sm text-mist-400">{t('Няма данни за периода.')}</p>;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.netCents)));
  return (
    <ul className="space-y-2.5">
      {rows.slice(0, 8).map((g) => (
        <li key={g.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium">{name(g)}</span>
            <span className={`num shrink-0 font-semibold ${g.netCents < 0 ? 'text-loss' : 'text-profit'}`}>{money(g.netCents)}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-asphalt-700"><div className={`h-full rounded-full ${g.netCents < 0 ? 'bg-loss' : 'bg-profit'}`} style={{ width: `${Math.max(2, (Math.abs(g.netCents) / max) * 100)}%` }} /></div>
          <div className="mt-0.5 text-[11px] text-mist-400">{t('{0} курса · {1} · {2}/км · навреме {3}%', g.trips, km(g.km), money(g.km > 0 ? g.netCents / g.km : 0), Math.round((g.onTime / g.trips) * 100))}{sub ? <> · {sub(g)}</> : null}</div>
        </li>
      ))}
    </ul>
  );
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  await initLocale();
  const requested = Number((await searchParams).d);
  const days = (PERIODS as readonly number[]).includes(requested) ? requested : 30;
  const { db, user, company, now } = await gameContext();
  const a = await companyAnalytics(db, company.id, days, now);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('Анализ')}
        subtitle={t('Кое носи пари: камиони, шофьори, линии и товари.')}
        help={t('Броят се приключените доставки в периода. „Нетно“ е резултатът от курса след гориво, такси, поддръжка, наем, неустойки, бонуси и вноската към компанията — както е уреден от сървъра. Заплатите, ремонтите и покупките са в Финанси. При наети камиони горивото е в наема, затова не влиза в разхода на гориво.')}
        actions={<Segmented label={t('Период')} active={String(days)} items={PERIODS.map((p) => ({ id: String(p), label: t('{0} дни', p), href: `/game/analytics?d=${p}` }))} />}
      />
      {!user.seenHints.includes('analytics') && <Hint id="analytics" />}
      {a.trips === 0 ? (
        <Card><Empty icon={BarChart3} title={t('Още няма доставки за периода')}>{t('Изпълни няколко поръчки и тук ще видиш кое носи най-много.')}</Empty></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
            <Stat label={t('Нетно')} value={money(a.netCents)} tone={a.netCents < 0 ? 'loss' : 'profit'} icon={TrendingUp} hint={t('от {0} възнаграждения', money(a.revenueCents))} />
            <Stat label={t('Курсове')} value={int(a.trips)} tone="cyan" icon={Truck} hint={t('{0} · {1} т', km(a.km), int(a.tons))} />
            <Stat label={t('Навреме')} value={`${Math.round(a.onTimeShare * 100)}%`} tone="gold" icon={Clock} hint={t('{0} нетно на км', money(a.netPerKmCents))} />
            <Stat label={t('Гориво')} value={a.litresPer100 ? t('{0} л/100 км', dec(a.litresPer100)) : '—'} tone="prestige" icon={Fuel} hint={a.fuelCentsPerKm ? t('{0} на 100 км', money(a.fuelCentsPerKm * 100)) : t('само собствени камиони')} />
          </div>
          <Card title={t('Нетно по дни · {0} дни', days)}><NetChart days={a.daily} /></Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title={t('Камиони')}>
              <Ranking rows={a.vehicles} name={(g) => { const v = a.names.vehicle[g.key]; return v ? `${v.plate} · ${powerUnitModel(v.modelId).name}${v.sold ? t(' (продаден)') : ''}` : '—'; }} />
            </Card>
            <Card title={t('Шофьори')}>
              <Ranking rows={a.drivers} name={(g) => a.names.driver[g.key] ?? t('освободен шофьор')} />
            </Card>
            <Card title={<span className="inline-flex items-center gap-2"><Route className="h-4 w-4 text-mist-400" />{t('Най-печеливши линии')}</span>}>
              <Ranking rows={a.lanes} name={(g) => a.names.lane[g.key]} />
            </Card>
            <Card title={t('Видове товари')}>
              <Ranking rows={a.cargo} name={(g) => CARGO[g.key as CargoType]?.label ?? g.key} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

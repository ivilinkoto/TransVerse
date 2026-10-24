import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { dateTime, duration, km, money } from '@/lib/format';
import { appUrl } from '@/server/discord/config';
import { gameContext } from '@/server/game/context';
import { tripLog } from '@/server/game/trip-log';
import { OUTCOME_LABELS, type ReeferOutcome } from '@/lib/game/reefer';

export const metadata = { title: 'Курс' };

/** The route as a small SVG (real coordinates). */
function RouteSketch({ points }: { points: [number, number][] }) {
  const W = 600;
  const H = 360;
  const lats = points.map((p) => p[0]);
  const lons = points.map((p) => p[1]);
  const [south, north, west, east] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
  const k = Math.cos((((south + north) / 2) * Math.PI) / 180);
  const span = Math.max((north - south) || 0.5, ((east - west) || 0.5) * k);
  const s = Math.min(W, H) / (span * 1.15);
  const x = (p: [number, number]) => W / 2 + (p[1] - (west + east) / 2) * k * s;
  const y = (p: [number, number]) => H / 2 - (p[0] - (south + north) / 2) * s;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)} ${y(p).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-2xl bg-asphalt-900" role="img" aria-label="Маршрут на курса">
      <path d={d} fill="none" stroke="#22d3ee" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(points[0]!)} cy={y(points[0]!)} r={8} fill="#f97316" />
      <circle cx={x(points[points.length - 1]!)} cy={y(points[points.length - 1]!)} r={8} fill="#2fd27a" />
    </svg>
  );
}

/** The temperatures of a refrigerated load along the way, with its range. */
function TempChart({ r }: { r: { min: number; max: number; readings: number[]; outcome: string; cents: number } }) {
  const W = 600;
  const H = 140;
  const lo = Math.min(r.min - 2, ...r.readings);
  const hi = Math.max(r.max + 2, ...r.readings);
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const x = (i: number) => (i / Math.max(1, r.readings.length - 1)) * W;
  return (
    <Card title="🌡️ Температура в хладилника" actions={<Badge tone={r.outcome === 'perfect' ? 'green' : r.outcome === 'slip' ? 'gold' : 'red'}>{OUTCOME_LABELS[r.outcome as ReeferOutcome]} · {money(r.cents)}</Badge>}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Температура по пътя">
        <rect x={0} y={y(r.max)} width={W} height={y(r.min) - y(r.max)} fill="#22d3ee" opacity={0.12} />
        <polyline points={r.readings.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke="#f97316" strokeWidth={3} />
      </svg>
      <p className="mt-1 text-xs text-mist-400">Норма {r.min}…{r.max} °C (синята ивица). Игрови данни.</p>
    </Card>
  );
}

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { db, user, features } = await gameContext();
  if (!features.trip_log) notFound();
  const t = await tripLog(db, id, { userId: user.id });
  if (!t) notFound();
  const link = `${appUrl()}/trip/${id}`;
  const st = t.stats;
  return (
    <div className="space-y-6">
      <PageHeader title={`${t.from} → ${t.to}`} subtitle={`${t.goods} · ${t.tons} т · ${t.plate ?? ''} · ${dateTime(t.completedAt)}`} actions={<Link href="/game/trips" className="btn-ghost">← Дневник</Link>} />
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card title="Маршрут" actions={<Badge tone={t.late ? 'red' : 'green'}>{t.late ? 'закъснял' : 'навреме'}</Badge>}>
          <RouteSketch points={t.points} />
          <p className="mt-2 text-xs text-mist-400">Реален маршрут · {t.countries.join(' → ')}</p>
        </Card>
        <Card title="Числата">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="label">Разстояние</dt><dd className="num">{km(t.km)}</dd></div>
            <div><dt className="label">Общо време</dt><dd className="num">{duration(st.totalMin)}</dd></div>
            <div><dt className="label">Зад волана</dt><dd className="num">{duration(st.driveMin)}</dd></div>
            <div><dt className="label">Средна скорост</dt><dd className="num">{st.avgKmh} км/ч</dd></div>
            <div><dt className="label">Почивки</dt><dd className="num">{st.breaks} · {duration(st.restMin)}</dd></div>
            <div><dt className="label">Граници</dt><dd className="num">{st.borders} · {duration(st.borderMin)}</dd></div>
            {st.seaMin > 0 && <div><dt className="label">Ферибот / влак</dt><dd className="num">{duration(st.seaMin)}</dd></div>}
            {st.stopsMin > 0 && <div><dt className="label">Непредвидени спирания</dt><dd className="num">{duration(st.stopsMin)}</dd></div>}
            <div><dt className="label">Нетен резултат</dt><dd className="num text-profit">{money(t.payoutCents)}</dd></div>
            <div><dt className="label">Опит</dt><dd className="num">+{t.xp}</dd></div>
          </dl>
          {t.ledger.length > 0 && (
            <ul className="mt-4 space-y-1 border-t border-asphalt-800 pt-3 text-xs">
              {t.ledger.map((e, i) => <li key={i} className="flex justify-between gap-2"><span className="text-mist-300">{e.description}</span><span className={`num ${e.amountCents < 0 ? 'text-loss' : 'text-profit'}`}>{money(e.amountCents)}</span></li>)}
            </ul>
          )}
        </Card>
      </div>
      {t.reefer && <TempChart r={t.reefer} />}
      <Card title="Сподели">
        {t.sharedAt ? (
          <div className="space-y-3 text-sm">
            <p className="text-mist-300">Курсът е публичен: всеки с линка вижда маршрута, товара и числата (без сумите от сметката ти).</p>
            <p className="break-all rounded-xl bg-asphalt-900 p-2 font-mono text-xs">{link}</p>
            <div className="flex flex-wrap gap-2">
              <a className="btn-primary" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`} target="_blank" rel="noopener noreferrer">Сподели във Facebook</a>
              <a className="btn-ghost" href={`/api/trip-card/${id}`} target="_blank" rel="noopener noreferrer">Картинката</a>
              <ActionButton action={{ type: 'shareTrip', deliveryId: id, on: false }} className="btn-ghost">Спри споделянето</ActionButton>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-mist-300">Направи курса публичен и вземи картичка за Facebook или Discord — маршрут, товар и време. Сумите от сметката ти не се показват.</p>
            <ActionButton action={{ type: 'shareTrip', deliveryId: id, on: true }} className="btn-primary">Сподели курса</ActionButton>
          </div>
        )}
      </Card>
    </div>
  );
}

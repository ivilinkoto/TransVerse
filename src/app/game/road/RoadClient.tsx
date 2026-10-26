'use client';

import { Hand, Radio, Send, ThumbsDown, ThumbsUp, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Card, Empty } from '@/components/ui';
import { api } from '@/lib/client/api';
import { CB, REPORT_KIND_IDS, REPORT_KINDS, type ReportKind } from '@/lib/game/live-road';
import { t as tr, tx, intlLocale } from '@/i18n/t';

interface Feed {
  onRoad: boolean;
  near: string | null;
  messages: { id: number; username: string; mine: boolean; body: string; near: string; km: number; at: string }[];
}
interface Report {
  id: number;
  kind: ReportKind;
  near: string;
  username: string;
  mine: boolean;
  voted: boolean;
  confirms: number;
  denies: number;
  km: number | null;
  createdAt: string;
  expiresAt: string;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });

interface Rider {
  id: number;
  name: string;
  who: string;
  status: string;
  fareCents: number;
  waitUntil: string;
  from: string;
  to: string;
}

const RIDER_STATUS: Record<string, string> = { aboard: 'в камиона', done: 'пристигна', missed: 'хвана друга кола' };

export function RoadClient({ trucks, feed, reports, cbLive, reportsLive, riders = [] }: { trucks: { vehicleId: string; plate: string }[]; feed: Feed | null; reports: Report[]; cbLive: boolean; reportsLive: boolean; riders?: Rider[] }) {
  const router = useRouter();
  const [vehicleId, setVehicleId] = useState(trucks[0]?.vehicleId ?? '');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // The radio is live: fresh messages and reports every 15 seconds.
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [router]);

  const run = async (body: unknown, done?: string) => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', body);
      if (done) setNote(done);
      router.refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const picker = trucks.length > 1 && (
    <select className="input text-sm" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} aria-label={tr('От кой камион')}>
      {trucks.map((t) => <option key={t.vehicleId} value={t.vehicleId}>{tx(t.plate)}</option>)}
    </select>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      {cbLive && feed && (
        <Card title={<span className="inline-flex items-center gap-2"><Radio className="h-4 w-4 text-amber-sig" />{tr('CB канал {0}{1}', CB.channel, feed.near ? tr(' · край {0}', feed.near) : '')}</span>}>
          {!feed.onRoad ? (
            <Empty icon={Radio} title={tr('Радиото мълчи')}>{tr('CB радиото работи от камион на път. Изпрати курс и се включи — ще чуеш шофьорите до {0} км около теб.', CB.radiusKm)}</Empty>
          ) : (
            <>
              <ul className="max-h-[28rem] space-y-2 overflow-y-auto pr-1 text-sm">
                {feed.messages.length === 0 && <li className="text-mist-400">{tr('Тишина в ефира. Кажи нещо първи!')}</li>}
                {feed.messages.map((m) => (
                  <li key={m.id} className={`rounded-lg px-3 py-2 ${m.mine ? 'bg-amber-sig/10' : 'bg-asphalt-800'}`}>
                    <div className="flex justify-between gap-2 text-[11px] text-mist-400"><span className="font-semibold text-mist-200">{tx(m.username)}</span><span>{tr('{0} · край {1}{2}', time(m.at), m.near, m.mine ? '' : tr(' · {0} км', m.km))}</span></div>
                    <div className="mt-0.5 break-words">{tx(m.body)}</div>
                  </li>
                ))}
              </ul>
              <form
                className="mt-3 flex flex-wrap gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await run({ type: 'cbSend', body: text, vehicleId: vehicleId || undefined })) setText('');
                }}
              >
                {picker}
                <input className="input min-w-0 flex-1" value={text} maxLength={CB.maxLength} onChange={(e) => setText(e.target.value)} placeholder={tr('Внимание, опашка на границата…')} aria-label={tr('Съобщение по CB')} />
                <button className="btn-primary" disabled={busy || !text.trim()}><Send className="h-4 w-4" />{tr('Предай')}</button>
              </form>
            </>
          )}
        </Card>
      )}
      {reportsLive && (
        <Card title={<span className="inline-flex items-center gap-2"><TriangleAlert className="h-4 w-4 text-amber-sig" />{tr('Сигнали по пътя')}</span>}>
          {trucks.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {trucks.length > 1 && picker}
              {REPORT_KIND_IDS.map((k) => (
                <button key={k} type="button" className="btn-ghost px-3 py-1.5 text-sm" disabled={busy} onClick={() => void run({ type: 'roadReport', kind: k, vehicleId: vehicleId || undefined }, tr('Сигналът „{0}“ е на картата.', REPORT_KINDS[k].label))}>
                  {tx(REPORT_KINDS[k].emoji)} {tx(REPORT_KINDS[k].label)}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-mist-400">{tr('Сигнал се дава от камион на път — там, където е камионът.')}</p>
          )}
          <ul className="mt-4 divide-y divide-white/5 text-sm">
            {reports.length === 0 && <li className="py-2 text-mist-400">{trucks.length ? tr('Няма сигнали около камионите ти.') : tr('Няма активни сигнали.')}</li>}
            {reports.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {tx(REPORT_KINDS[r.kind].emoji)} <b>{tx(REPORT_KINDS[r.kind].label)}</b>{' '}{tr('край {0}', r.near)}
                  <span className="block text-[11px] text-mist-400">{tr('{0} · {1}{2} · 👍 {3} · 👎 {4} · до {5}', r.username, time(r.createdAt), r.km != null ? tr(' · {0} км от теб', r.km) : '', r.confirms, r.denies, time(r.expiresAt))}</span>
                </span>
                {!r.mine && !r.voted && (
                  <span className="flex gap-1">
                    <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => void run({ type: 'roadVote', reportId: r.id, vote: 1 }, tr('Благодарим — потвърдено.'))} aria-label={tr('Потвърди')}><ThumbsUp className="h-3.5 w-3.5" />{tr('Има го')}</button>
                    <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => void run({ type: 'roadVote', reportId: r.id, vote: -1 }, tr('Отбелязано — няма го.'))} aria-label={tr('Отхвърли')}><ThumbsDown className="h-3.5 w-3.5" />{tr('Няма го')}</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {riders.length > 0 && (
        <Card title={<span className="inline-flex items-center gap-2"><Hand className="h-4 w-4 text-profit" />{tr('Автостопаджии')}</span>} className="lg:col-span-2">
          <ul className="divide-y divide-white/5 text-sm">
            {riders.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><b>{tx(r.name)}</b>, {tx(r.who)} · {tx(r.from)} → {tx(r.to)} · <span className="num">{tr('{0} лв.', (r.fareCents / 100).toLocaleString(intlLocale()))}</span>
                  <span className="block text-[11px] text-mist-400">{r.status === 'waiting' ? tr('Чака до {0}', time(r.waitUntil)) : RIDER_STATUS[r.status] ?? r.status}</span>
                </span>
                {r.status === 'waiting' && <button type="button" className="btn-primary px-3 py-1.5 text-sm" disabled={busy} onClick={() => void run({ type: 'pickHitchhiker', id: r.id }, tr('{0} се качи. Плаща при пристигане.', r.name))}>{tr('👋 Вземи')}</button>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {(error || note) && <p role={error ? 'alert' : 'status'} className={`text-sm lg:col-span-2 ${error ? 'text-loss' : 'text-profit'}`}>{error ?? note}</p>}
    </div>
  );
}

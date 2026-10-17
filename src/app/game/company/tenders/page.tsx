import { CheckCircle2, Clock, Gavel, Landmark, Route, Truck, XCircle } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge, Card, Empty, Meter } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { dateTime, dec, duration, int, km, money } from '@/lib/format';
import { MAX_ACTIVE_TENDERS } from '@/lib/game/tenders';
import { gameContext } from '@/server/game/context';
import { companyHub } from '@/server/game/membership';
import { ensureTenderOffers, tenderBoard } from '@/server/game/tenders';

export const metadata = { title: 'Търгове на компанията' };

export default async function CompanyTendersPage() {
  const { db, user, now } = await gameContext();
  const hub = await companyHub(db, user.id);
  if (!hub) redirect('/game/company');
  await ensureTenderOffers(db, hub.company.id, now).catch((e) => console.warn('[tenders] offers', e));
  const board = await tenderBoard(db, hub.company.id, now);
  const canAccept = hub.rank.isOwner || hub.rank.permissions.includes('manage_tenders');
  const full = board.active.length >= MAX_ACTIVE_TENDERS;
  const place = (c?: { nameBg: string; country: string }) => (c ? `${c.nameBg}${c.country !== 'BG' ? ` (${c.country})` : ''}` : '—');
  return (
    <div className="space-y-5">
      <Card>
        <p className="text-sm text-mist-300">
          Търгът е голяма поръчка, разделена на много курсове. Приема се с <span className="font-semibold">депозит от касата</span>; курсовете се появяват на борсата <span className="font-semibold">само за членовете</span> и всеки курс плаща на шофьора си като обикновена поръчка. Ако всички курсове пристигнат преди срока — касата получава бонус, депозитът се връща и компанията получава опит. Ако не — депозитът се губи.
        </p>
        <p className="mt-2 text-xs text-mist-400">Приемат собственикът и длъжностите с право „Търгове“. Най-много {MAX_ACTIVE_TENDERS} търга едновременно. Каса: <span className="num text-gold-400">{money(hub.company.treasuryCents)}</span></p>
      </Card>

      {board.active.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-bold">Изпълнявани търгове</h2>
          {board.active.map((t) => {
            const left = (t.deadlineAt!.getTime() - now.getTime()) / 60_000;
            return (
              <Card key={t.id} title={<span className="inline-flex items-center gap-2"><Gavel className="h-4 w-4 text-prestige" />{t.title}</span>} actions={<Badge tone={left < 120 ? 'red' : 'cyan'}><Clock className="h-3 w-3" />остават {duration(left)}</Badge>}>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-mist-300">
                  <span>{t.goods} · {int(t.loads)} × {dec(t.loadTons)} т</span>
                  <span className="inline-flex items-center gap-1"><Route className="h-3.5 w-3.5" />{place(t.origin)} → {place(t.destination)} · {km(t.distanceKm)}</span>
                  <span>{money(t.rewardPerLoadCents)} на курс за шофьора</span>
                </div>
                <div className="mt-3 flex justify-between text-xs text-mist-400">
                  <span className="num">Доставени {t.deliveredLoads} / {t.loads}{t.onRoad ? ` · на път ${t.onRoad}` : ''}</span>
                  <span>срок {dateTime(t.deadlineAt!)}</span>
                </div>
                <Meter value={(t.deliveredLoads / t.loads) * 100} tone="violet" className="mt-1" />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-mist-300">При успех: <span className="num font-semibold text-gold-400">+{money(t.bonusCents)}</span> в касата + депозитът {money(t.depositCents)} обратно + {int(t.xp)} опит</span>
                  <Link href="/game/contracts" className="btn-primary px-3 py-1.5 text-sm"><Truck className="h-4 w-4" />Вземи курс от борсата</Link>
                </div>
                {t.driverNames.length > 0 && <p className="mt-2 text-xs text-mist-400">Шофьори: {t.driverNames.map((d) => `${d.username} (${d.loads})`).join(', ')}</p>}
              </Card>
            );
          })}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold">Оферти</h2>
        {board.offers.length === 0 ? (
          <Card><Empty icon={Gavel} title="Няма оферти в момента">Нови оферти се появяват всеки ден.</Empty></Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {board.offers.map((t) => (
              <Card key={t.id} className="flex flex-col" title={<span className="text-base">{t.title}</span>}>
                <ul className="space-y-1 text-sm text-mist-300">
                  <li>{t.goods} · <span className="num font-semibold text-white">{int(t.loads)} курса × {dec(t.loadTons)} т</span></li>
                  <li className="inline-flex items-center gap-1"><Route className="h-3.5 w-3.5" />{km(t.distanceKm)} в посока</li>
                  <li>Срок след приемане: <span className="font-semibold text-white">{duration(t.durationHours * 60)}</span></li>
                  <li>На шофьора: <span className="num">{money(t.rewardPerLoadCents)}</span> на курс</li>
                </ul>
                <div className="mt-3 rounded-xl border border-asphalt-700 p-3 text-sm">
                  <div className="flex justify-between"><span className="text-mist-400">Бонус за касата</span><span className="num font-semibold text-gold-400">{money(t.bonusCents)}</span></div>
                  <div className="flex justify-between"><span className="text-mist-400">Опит за компанията</span><span className="num text-prestige">+{int(t.xp)}</span></div>
                  <div className="flex justify-between"><span className="text-mist-400 inline-flex items-center gap-1"><Landmark className="h-3.5 w-3.5" />Депозит от касата</span><span className="num">{money(t.depositCents)}</span></div>
                </div>
                <div className="mt-auto pt-3">
                  {canAccept ? (
                    <ActionButton
                      action={{ type: 'acceptTender', tenderId: t.id }}
                      className="btn-gold w-full justify-center"
                      disabled={full || hub.company.treasuryCents < t.depositCents}
                      confirm={`Да приемем ли търга? От касата се взима депозит ${money(t.depositCents)}; ${t.loads} курса трябва да пристигнат до ${duration(t.durationHours * 60)}.`}
                    >
                      {full ? `Вече изпълнявате ${MAX_ACTIVE_TENDERS} търга` : hub.company.treasuryCents < t.depositCents ? 'Недостатъчно в касата' : 'Приеми търга'}
                    </ActionButton>
                  ) : (
                    <p className="text-xs text-mist-400">Търгове приемат собственикът и длъжностите с право „Търгове“.</p>
                  )}
                  <p className="mt-2 text-center text-xs text-mist-400">Офертата изтича {dateTime(t.offerExpiresAt)}</p>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {board.history.length > 0 && (
        <Card title="Предишни търгове">
          <ul className="divide-y divide-asphalt-800 text-sm">
            {board.history.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="flex items-center gap-2">{t.status === 'completed' ? <CheckCircle2 className="h-4 w-4 text-profit" /> : <XCircle className="h-4 w-4 text-loss" />}{t.title}</span>
                <span className="num text-xs text-mist-400">{t.deliveredLoads}/{t.loads} курса · {t.status === 'completed' ? <span className="text-profit">+{money(t.bonusCents)}</span> : <span className="text-loss">−{money(t.depositCents)} депозит</span>} · {t.finishedAt ? dateTime(t.finishedAt) : ''}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

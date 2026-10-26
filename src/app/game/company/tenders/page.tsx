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
import { t as tr, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Търгове на компанията') };
}

export default async function CompanyTendersPage() {
  await initLocale();
  const { db, user, now } = await gameContext();
  const hub = await companyHub(db, user.id);
  if (!hub) redirect('/game/company');
  await ensureTenderOffers(db, hub.company.id, now).catch((e) => console.warn('[tenders] offers', e));
  const board = await tenderBoard(db, hub.company.id, now);
  const canAccept = hub.rank.isOwner || hub.rank.permissions.includes('manage_tenders');
  const full = board.active.length >= MAX_ACTIVE_TENDERS;
  const place = (c?: { nameBg: string; country: string }) => (c ? `${tx(c.nameBg)}${c.country !== 'BG' ? ` (${c.country})` : ''}` : '—');
  return (
    <div className="space-y-5">
      <Card>
        <p className="text-sm text-mist-300">
          {tr('Търгът е голяма поръчка, разделена на много курсове. Приема се с')}{' '}<span className="font-semibold">{tr('депозит от касата')}</span>{tr('; курсовете се появяват на борсата')}{' '}<span className="font-semibold">{tr('само за членовете')}</span>{' '}{tr('и всеки курс плаща на шофьора си като обикновена поръчка. Ако всички курсове пристигнат преди срока — касата получава бонус, депозитът се връща и компанията получава опит. Ако не — депозитът се губи.')}
        </p>
        <p className="mt-2 text-xs text-mist-400">{tr('Приемат собственикът и длъжностите с право „Търгове“. Най-много {0} търга едновременно. Каса:', MAX_ACTIVE_TENDERS)}{' '}<span className="num text-gold-400">{money(hub.company.treasuryCents)}</span></p>
      </Card>

      {board.active.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-bold">{tr('Изпълнявани търгове')}</h2>
          {board.active.map((t) => {
            const left = (t.deadlineAt!.getTime() - now.getTime()) / 60_000;
            return (
              <Card key={t.id} title={<span className="inline-flex items-center gap-2"><Gavel className="h-4 w-4 text-prestige" />{tx(t.title)}</span>} actions={<Badge tone={left < 120 ? 'red' : 'cyan'}><Clock className="h-3 w-3" />{tr('остават {0}', duration(left))}</Badge>}>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-mist-300">
                  <span>{tr('{0} · {1} × {2} т', t.goods, int(t.loads), dec(t.loadTons))}</span>
                  <span className="inline-flex items-center gap-1"><Route className="h-3.5 w-3.5" />{place(t.origin)} → {place(t.destination)} · {km(t.distanceKm)}</span>
                  <span>{tr('{0} на курс за шофьора', money(t.rewardPerLoadCents))}</span>
                </div>
                <div className="mt-3 flex justify-between text-xs text-mist-400">
                  <span className="num">{tr('Доставени {0} / {1}{2}', t.deliveredLoads, t.loads, t.onRoad ? tr(' · на път {0}', t.onRoad) : '')}</span>
                  <span>{tr('срок {0}', dateTime(t.deadlineAt!))}</span>
                </div>
                <Meter value={(t.deliveredLoads / t.loads) * 100} tone="violet" className="mt-1" />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-mist-300">{tr('При успех:')}{' '}<span className="num font-semibold text-gold-400">+{money(t.bonusCents)}</span>{' '}{tr('в касата + депозитът {0} обратно + {1} опит', money(t.depositCents), int(t.xp))}</span>
                  <Link href="/game/contracts" className="btn-primary px-3 py-1.5 text-sm"><Truck className="h-4 w-4" />{tr('Вземи курс от борсата')}</Link>
                </div>
                {t.driverNames.length > 0 && <p className="mt-2 text-xs text-mist-400">{tr('Шофьори:')}{' '}{t.driverNames.map((d) => `${d.username} (${d.loads})`).join(', ')}</p>}
              </Card>
            );
          })}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold">{tr('Оферти')}</h2>
        {board.offers.length === 0 ? (
          <Card><Empty icon={Gavel} title={tr('Няма оферти в момента')}>{tr('Нови оферти се появяват всеки ден.')}</Empty></Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {board.offers.map((t) => (
              <Card key={t.id} className="flex flex-col" title={<span className="text-base">{tx(t.title)}</span>}>
                <ul className="space-y-1 text-sm text-mist-300">
                  <li>{tx(t.goods)} · <span className="num font-semibold text-white">{tr('{0} курса × {1} т', int(t.loads), dec(t.loadTons))}</span></li>
                  <li className="inline-flex items-center gap-1"><Route className="h-3.5 w-3.5" />{tr('{0} в посока', km(t.distanceKm))}</li>
                  <li>{tr('Срок след приемане:')}{' '}<span className="font-semibold text-white">{duration(t.durationHours * 60)}</span></li>
                  <li>{tr('На шофьора:')}{' '}<span className="num">{money(t.rewardPerLoadCents)}</span>{' '}{tr('на курс')}</li>
                </ul>
                <div className="mt-3 rounded-xl border border-asphalt-700 p-3 text-sm">
                  <div className="flex justify-between"><span className="text-mist-400">{tr('Бонус за касата')}</span><span className="num font-semibold text-gold-400">{money(t.bonusCents)}</span></div>
                  <div className="flex justify-between"><span className="text-mist-400">{tr('Опит за компанията')}</span><span className="num text-prestige">+{int(t.xp)}</span></div>
                  <div className="flex justify-between"><span className="text-mist-400 inline-flex items-center gap-1"><Landmark className="h-3.5 w-3.5" />{tr('Депозит от касата')}</span><span className="num">{money(t.depositCents)}</span></div>
                </div>
                <div className="mt-auto pt-3">
                  {canAccept ? (
                    <ActionButton
                      action={{ type: 'acceptTender', tenderId: t.id }}
                      className="btn-gold w-full justify-center"
                      disabled={full || hub.company.treasuryCents < t.depositCents}
                      confirm={tr('Да приемем ли търга? От касата се взима депозит {0}; {1} курса трябва да пристигнат до {2}.', money(t.depositCents), t.loads, duration(t.durationHours * 60))}
                    >
                      {full ? tr('Вече изпълнявате {0} търга', MAX_ACTIVE_TENDERS) : hub.company.treasuryCents < t.depositCents ? tr('Недостатъчно в касата') : tr('Приеми търга')}
                    </ActionButton>
                  ) : (
                    <p className="text-xs text-mist-400">{tr('Търгове приемат собственикът и длъжностите с право „Търгове“.')}</p>
                  )}
                  <p className="mt-2 text-center text-xs text-mist-400">{tr('Офертата изтича {0}', dateTime(t.offerExpiresAt))}</p>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {board.history.length > 0 && (
        <Card title={tr('Предишни търгове')}>
          <ul className="divide-y divide-asphalt-800 text-sm">
            {board.history.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="flex items-center gap-2">{t.status === 'completed' ? <CheckCircle2 className="h-4 w-4 text-profit" /> : <XCircle className="h-4 w-4 text-loss" />}{tx(t.title)}</span>
                <span className="num text-xs text-mist-400">{tr('{0}/{1} курса ·', t.deliveredLoads, t.loads)}{' '}{t.status === 'completed' ? <span className="text-profit">+{money(t.bonusCents)}</span> : <span className="text-loss">{tr('−{0} депозит', money(t.depositCents))}</span>} · {t.finishedAt ? dateTime(t.finishedAt) : ''}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

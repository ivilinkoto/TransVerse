import { ArrowDownLeft, ArrowUpRight, Banknote, Fuel, Gavel, Landmark, TrendingDown, TrendingUp } from 'lucide-react';
import { ActionButton } from '@/components/ui/ActionButton';
import { FINE_RULES, VIOLATION_LABELS, type Violation } from '@/lib/game/fines';
import { finesOf } from '@/server/game/fines';
import { CashflowChart } from '@/components/game/CashflowChart';
import { Badge, Card, PageHeader, Stat } from '@/components/ui';
import { dateTime, money, moneyPrecise } from '@/lib/format';
import { TutorialVisit } from '@/components/game/TutorialVisit';
import { fuelPriceCents } from '@/lib/game/fuel';
import { countries } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { creditOf } from '@/server/game/business';
import { LoanForm } from '@/components/game/LoanForm';
import { tutorialPending } from '@/server/game/tutorial-flags';
import { LEDGER_LABELS, type LedgerCategory } from '@/server/game/finance';
import { financeSummary, ledgerPage } from '@/server/game/queries';
import { PlayerName } from '@/components/game/PlayerName';
import { TRANSFER_RULES } from '@/lib/game/transfers';
import { users } from '@/server/db/schema';
import { senderBlock, sentLast24h, transfersOf } from '@/server/game/transfers';
import { eq } from 'drizzle-orm';
import { LEASE } from '@/lib/game/leasing';
import { leasesOf } from '@/server/game/leasing';
import { t as tr, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Финанси') };
}

export default async function FinancePage() {
  await initLocale();
  const { db, user, company, now, features } = await gameContext();
  const credit = features.loans ? await creditOf(db, user.id, now) : null;
  const [summary, entries, fineRows, transfers, sent, [me]] = await Promise.all([
    financeSummary(db, company.id, 30),
    ledgerPage(db, company.id, 120),
    finesOf(db, company.id),
    transfersOf(db, user.id),
    sentLast24h(db, user.id, now),
    db.select({ level: users.level, createdAt: users.createdAt }).from(users).where(eq(users.id, user.id)),
  ]);
  const leases = features.leasing ? await leasesOf(db, company.id) : [];
  const transferBlock = me ? senderBlock(me, now) : null;
  const income = summary.byCategory.filter((c) => c.total > 0 && c.category !== 'starting_capital').reduce((s, c) => s + c.total, 0);
  const expense = -summary.byCategory.filter((c) => c.total < 0).reduce((s, c) => s + c.total, 0);
  const sorted = [...summary.byCategory].filter((c) => c.category !== 'starting_capital').sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  const maxAbs = Math.max(1, ...sorted.map((c) => Math.abs(c.total)));

  const visitPending = await tutorialPending(db, user.id, 'finances');
  const countryRows = await db.select({ code: countries.code }).from(countries).orderBy(countries.code);
  const fuel = countryRows.map((c) => ({ code: c.code, cents: fuelPriceCents(c.code, now) }));
  const cheapest = Math.min(...fuel.map((f) => f.cents));
  const dearest = Math.max(...fuel.map((f) => f.cents));
  return (
    <div className="space-y-6">
      <TutorialVisit step="finances" pending={visitPending} />
      <PageHeader title={tr('Финанси')} subtitle={tr('Приходи, разходи и всяко движение на парите.')}
        help={tr('Счетоводна книга: всяко движение на пари е запис с баланс след него. Всички суми се изчисляват от сървъра.')} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
        <Stat label={tr('Наличност')} value={money(company.balanceCents)} tone={company.balanceCents < 0 ? 'loss' : 'gold'} icon={Landmark} />
        <Stat label={tr('Приходи · 30 дни')} value={money(income)} tone="profit" icon={TrendingUp} />
        <Stat label={tr('Разходи · 30 дни')} value={money(expense)} tone="loss" icon={TrendingDown} hint={tr('Нетно {0}', money(income - expense))} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card title={tr('Паричен поток по дни')}><CashflowChart days={summary.daily} /></Card>
        <Card title={tr('По категории · 30 дни')}>
          <ul className="space-y-2.5 text-sm">
            {sorted.map((c) => (
              <li key={c.category}>
                <div className="flex justify-between"><span>{tx(LEDGER_LABELS[c.category as LedgerCategory] ?? c.category)}</span><span className={`num ${c.total >= 0 ? 'text-profit' : 'text-loss'}`}>{money(c.total)}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-asphalt-700"><div className={`h-full rounded-full ${c.total >= 0 ? 'bg-profit' : 'bg-loss'}`} style={{ width: `${(Math.abs(c.total) / maxAbs) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {fineRows.length > 0 && (
        <Card id="fines" title={<span className="inline-flex items-center gap-2"><Gavel className="h-4 w-4 text-mist-400" />{tr('Глоби')}</span>} actions={<span className="text-xs text-mist-400">{tr('плащане до {0} ч, после +{1}%', FINE_RULES.dueHours, Math.round(FINE_RULES.latePayShare * 100))}</span>}>
          <ul className="divide-y divide-asphalt-800 text-sm">
            {fineRows.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="font-medium">{tx(VIOLATION_LABELS[f.violation as Violation])} <span className="num text-loss">{money(f.amountCents)}</span></div>
                  <div className="text-xs text-mist-400">{dateTime(f.createdAt)}{f.status === 'unpaid' ? tr(' · срок {0}', dateTime(f.dueAt)) : ''}{f.note ? ` · ${f.note}` : ''}</div>
                </div>
                {f.status === 'unpaid' ? (
                  <div className="flex gap-2">
                    <ActionButton action={{ type: 'payFine', fineId: f.id }} className="btn-primary px-3 py-1.5 text-xs">{tr('Плати')}</ActionButton>
                    {!f.appealed && <ActionButton action={{ type: 'appealFine', fineId: f.id }} className="btn-ghost px-3 py-1.5 text-xs" confirm={tr('Обжалване: {0}% шанс глобата да отпадне, иначе става с {1}% по-голяма. Обжалваш ли?', Math.round(FINE_RULES.appealWinChance * 100), Math.round(FINE_RULES.appealLossShare * 100))}>{tr('Обжалвай')}</ActionButton>}
                  </div>
                ) : (
                  <Badge tone={f.status === 'dropped' ? 'green' : 'neutral'}>{f.status === 'dropped' ? tr('отменена') : f.status === 'auto_paid' ? tr('удържана') : tr('платена')}</Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {leases.length > 0 && (
        <Card id="leases" title={<span className="inline-flex items-center gap-2"><Landmark className="h-4 w-4 text-mist-400" />{tr('Лизинг')}</span>} actions={<span className="text-xs text-mist-400">{tr('вноските се теглят сами всяка седмица')}</span>}>
          <ul className="divide-y divide-asphalt-800 text-sm">
            {leases.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div>
                  <div className="font-semibold">{tx(l.plate)} · {tx(l.model)}</div>
                  <div className="text-xs text-mist-400">
                    {l.status === 'active'
                      ? <>{tr('Платени {0} от {1} вноски по {2} · следваща {3}', l.paid, l.payments, money(l.weeklyCents), dateTime(l.nextDueAt))}{l.missed > 0 && <span className="text-loss">{' '}{tr('· пропуснати {0} от {1}', l.missed, LEASE.maxMissed)}</span>}</>
                      : l.status === 'paid' ? tr('Изплатен — камионът е изцяло твой.') : tr('Камионът е върнат на лизинговата компания.')}
                  </div>
                </div>
                {l.status === 'active' ? (
                  <ActionButton action={{ type: 'payOffLease', leaseId: l.id }} className="btn-ghost px-3 py-1.5 text-xs" confirm={tr('Да изплатим ли лизинга на {0} сега за {1}?', l.plate, money(l.payoffCents))}>{tr('Изплати сега · {0}', money(l.payoffCents))}</ActionButton>
                ) : (
                  <Badge tone={l.status === 'paid' ? 'green' : 'red'}>{l.status === 'paid' ? tr('изплатен') : tr('върнат')}</Badge>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-mist-400">{tr('При предсрочно изплащане плащаш оставащата главница и половината от оставащата лихва. Камион на лизинг не може да се продаде, докато не се изплати.')}</p>
        </Card>
      )}
      {features.transfers && <Card id="transfers" title={<span className="inline-flex items-center gap-2"><Banknote className="h-4 w-4 text-mist-400" />{tr('Преводи между играчи')}</span>} actions={<span className="text-xs text-mist-400">{tr('такса {0} % · до {1} за 24 ч', Math.round(TRANSFER_RULES.feeShare * 100), money(TRANSFER_RULES.dailyLimitCents))}</span>}>
        <p className="mb-3 text-sm text-mist-400">
          {transferBlock ?? tr('За да изпратиш пари, отвори профила на играча (натисни името му или го потърси горе) → „Изпрати пари“. За 24 часа можеш да изпратиш още {0}', money(Math.max(0, TRANSFER_RULES.dailyLimitCents - sent)))}
        </p>
        {transfers.length === 0 ? <p className="text-sm text-mist-400">{tr('Още няма преводи.')}</p> : (
          <ul className="divide-y divide-asphalt-800 text-sm">
            {transfers.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <div className="flex min-w-0 items-center gap-2">
                  {t.outgoing ? <ArrowUpRight className="h-4 w-4 shrink-0 text-loss" /> : <ArrowDownLeft className="h-4 w-4 shrink-0 text-profit" />}
                  <div className="min-w-0">
                    <div className="truncate">{t.outgoing ? tr('До ') : tr('От ')}<PlayerName name={t.outgoing ? t.to : t.from} className="font-medium" />{t.note ? <span className="text-mist-400"> · „{tx(t.note)}“</span> : null}</div>
                    <div className="text-xs text-mist-400">{dateTime(t.createdAt)}{t.outgoing ? tr(' · такса {0}', money(t.feeCents)) : ''}</div>
                  </div>
                </div>
                <span className={`num shrink-0 font-semibold ${t.outgoing ? 'text-loss' : 'text-profit'}`}>{t.outgoing ? '−' : '+'}{money(t.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>}
      {credit && (
        <Card id="credit" title={<span className="inline-flex items-center gap-2"><Landmark className="h-4 w-4 text-mist-400" />{tr('Кредит')}</span>} actions={<span className="text-xs text-mist-400">{tr('игрова банка')}</span>}>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="font-display text-3xl font-bold">{tx(credit.rating)}</span>
            <span className="text-sm text-mist-300">{tr('кредитен рейтинг · {0}', credit.tier.label)}</span>
          </div>
          <p className="mt-1 text-xs text-mist-400">{tr('Рейтингът расте с нивото, доставките (особено навреме) и изплатените кредити; пада с пропуснатите вноски.')}</p>
          <div className="mt-4">
            {credit.active ? (
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{tr('Изплатено {0} от {1} · следваща вноска {2} на {3}{4}', money(credit.active.paidCents), money(credit.active.totalCents), money(credit.active.weeklyCents), dateTime(credit.active.nextDueAt), credit.active.missed ? tr(' · пропуснати: {0}', credit.active.missed) : '')}</span>
                <ActionButton action={{ type: 'repayLoan' }} className="btn-ghost px-3 py-1.5 text-xs" confirm={tr('Да изплатим ли наведнъж останалите {0}?', money(credit.active.totalCents - credit.active.paidCents))}>{tr('Изплати предсрочно')}</ActionButton>
              </div>
            ) : credit.tier.maxCents > 0 ? (
              <LoanForm maxCents={credit.tier.maxCents} rateBps={credit.tier.rateBps} />
            ) : (
              <p className="text-sm text-mist-400">{tr('Банката още не ти дава кредит — карай и доставяй навреме.')}</p>
            )}
          </div>
        </Card>
      )}
      <Card title={<span className="inline-flex items-center gap-2"><Fuel className="h-4 w-4 text-mist-400" />{tr('Дизел днес')}</span>} actions={<span className="text-xs text-mist-400">{tr('игрови цени · сменят се всеки ден')}</span>}>
        <p className="mb-3 text-sm text-mist-400">{tr('Горивото за курса се плаща по цените на държавите, през които минава камионът — пропорционално на километрите във всяка.')}</p>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {fuel.map((f) => (
            <li key={f.code} className="flex items-center justify-between rounded-lg bg-asphalt-850 px-3 py-2 text-sm"><span className="text-mist-300">{tx(f.code)}</span><span className={`num font-semibold ${f.cents <= cheapest * 1.05 ? 'text-profit' : f.cents >= dearest * 0.95 ? 'text-loss' : ''}`}>{tr('{0} лв./л', (f.cents / 100).toFixed(2))}</span></li>
          ))}
        </ul>
      </Card>
      <Card title={tr('Счетоводна книга')}>
        <ul className="divide-y divide-asphalt-800">
          {entries.map((e) => (
            <li key={e.id} className="flex items-start gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <div className="text-mist-100">{tx(e.description)}</div>
                <div className="text-xs text-mist-400">{dateTime(e.createdAt)} · {tx(LEDGER_LABELS[e.category as LedgerCategory] ?? e.category)}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className={`num whitespace-nowrap font-semibold ${e.amountCents >= 0 ? 'text-profit' : 'text-loss'}`}>{e.amountCents >= 0 ? '+' : ''}{moneyPrecise(e.amountCents)}</div>
                <div className="num whitespace-nowrap text-xs text-mist-400">{tr('баланс {0}', moneyPrecise(e.balanceAfterCents))}</div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

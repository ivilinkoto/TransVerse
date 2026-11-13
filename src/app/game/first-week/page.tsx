import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { money } from '@/lib/format';
import { ITEMS } from '@/lib/game/items';
import { gameContext } from '@/server/game/context';
import { firstWeekView } from '@/server/game/first-week';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Първите 7 дни') };
}

/** 1.4 „Първите 7 дни“: a step a day for a new player, with its reward. */
export default async function FirstWeekPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.first_week) notFound();
  const v = await firstWeekView(db, user.id, now);
  return (
    <div className="space-y-4">
      <PageHeader title={t('Първите 7 дни')} subtitle={t('Всеки ден нова стъпка с награда. Накрая — значка и златен кейс.')} />
      {!v ? (
        <p className="text-sm text-mist-400" data-testid="first-week-over">{t('Първата седмица е зад гърба ти. Успех на пътя!')}</p>
      ) : (
        <Card title={t('Ден {0} от 7 · взети {1} от 7', v.day, v.claimed)}>
          <ol className="space-y-3" data-testid="first-week-steps">
            {v.steps.map((s) => (
              <li key={s.id} className={`rounded-xl border p-3 ${s.claimed ? 'border-emerald-500/40 bg-emerald-500/5' : s.open ? 'border-asphalt-700' : 'border-asphalt-800 opacity-60'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{t('Ден {0}', s.day)} · {tx(s.label)}</span>
                  {s.claimed ? <span className="text-sm text-emerald-300">{t('✓ взето')}</span>
                    : !s.open ? <span className="text-xs text-mist-400">{t('отваря се на ден {0}', s.day)}</span>
                    : s.done ? <ActionButton action={{ type: 'claimFirstWeek', step: s.id }} className="game-action game-action-gold flex-row px-3 py-1.5 text-xs">{t('Вземи наградата')}</ActionButton>
                    : <Link href={s.href} className="text-sm text-cyan-glow hover:underline">{t('Към задачата →')}</Link>}
                </div>
                {s.open && !s.claimed && <p className="mt-1 text-sm text-mist-300">{tx(s.hint)} <span className="num text-mist-400">({s.progress} / {s.target})</span></p>}
                <p className="mt-1 text-xs text-mist-400">{[money(s.cents), ...(s.items ?? []).map((i) => (i.qty > 1 ? `${tx(ITEMS[i.itemId].name)} ×${i.qty}` : tx(ITEMS[i.itemId].name)))].join(' + ')}</p>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-mist-400">{t('Пропуснат ден не се губи — стъпките стоят отворени още {0} дни.', v.daysLeft)}</p>
        </Card>
      )}
    </div>
  );
}

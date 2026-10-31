import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Search } from 'lucide-react';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { money } from '@/lib/format';
import { CLUES, CLUE_LABELS, LOST, SUSPECTS } from '@/lib/game/lost-cargo';
import { gameContext } from '@/server/game/context';
import { caseOf } from '@/server/game/lost-cargo';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Изгубена пратка') };
}

/** 1.1.4.2 „Изгубена пратка“: three clues, one accusation. */
export default async function CasePage() {
  await initLocale();
  const { db, user, features } = await gameContext();
  if (!features.lost_cargo) notFound();
  const c = await caseOf(db, user.id);
  return (
    <div className="space-y-6">
      <PageHeader title={t('Изгубена пратка')} subtitle={t('Рядко палет изчезва след доставка. Разгледай уликите и посочи кой е виновен — веднъж.')} />
      {!c ? <Empty icon={Search} title={t('Няма случай')}>{t('Когато изчезне палет, ще получиш известие.')}</Empty> : (
        <>
          <Card title={t('Липсва: {0}', tx(c.goods))} actions={c.closed ? <Badge tone={c.solved ? 'green' : 'red'}>{c.solved ? t('Разкрит') : t('Грешен извод')}</Badge> : null}>
            <p className="text-sm text-mist-300">{t('Награда при разкриване: {0} и {1} ТрансКоин. Грешен извод: −1 репутация.', money(LOST.rewardCents), LOST.coins)}</p>
            <ul className="mt-3 space-y-2">
              {CLUES.map((clue, i) => {
                const seen = c.clues.find((x) => x.clue === clue);
                return (
                  <li key={clue} className="rounded-xl border border-asphalt-700 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">{tx(CLUE_LABELS[clue])} · {tx(SUSPECTS[i]!)}</span>
                      {!seen && !c.closed && <ActionButton action={{ type: 'lookClue', id: c.id, clue }} className="btn-ghost px-3 py-1 text-xs">{t('Разгледай')}</ActionButton>}
                    </div>
                    {seen && <p className={`mt-1 ${seen.odd ? 'text-amber-sig' : 'text-mist-300'}`}>{tx(seen.text)}</p>}
                  </li>
                );
              })}
            </ul>
          </Card>
          {!c.closed ? (
            <Card title={t('Кой е виновен?')}>
              <div className="flex flex-wrap gap-2">
                {SUSPECTS.map((s, i) => <ActionButton key={s} action={{ type: 'accuse', id: c.id, suspect: i }} confirm={t('Сигурен ли си? Посочваш само веднъж.')} className="btn-ghost px-3 py-1.5 text-sm">{tx(s)}</ActionButton>)}
              </div>
            </Card>
          ) : (
            <Card title={t('Развръзка')}>
              <p className="text-sm">{t('Виновен беше: {0}.', tx(SUSPECTS[c.culprit ?? 0]!))} {c.solved ? t('Пратката е върната.') : t('Посочи: {0}.', tx(c.accused ?? ''))}</p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Mail } from 'lucide-react';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { EmptyAction } from '@/components/game/EmptyAction';
import { MarkLettersRead } from '@/components/game/MarkLettersRead';
import { dateTime, money } from '@/lib/format';
import { LETTERS } from '@/lib/game/letters';
import { gameContext } from '@/server/game/context';
import { lettersView } from '@/server/game/letters';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Писма от клиенти') };
}

/** 1.2.3.6: what the clients wrote after the deliveries. */
export default async function LettersPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.client_letters) notFound();
  const letters = await lettersView(db, user.id, now);
  return (
    <div className="space-y-6">
      <PageHeader title={t('✉️ Писма от клиенти')} subtitle={t('Клиентът понякога пише: благодари с бонус, оплаква се от закъснение или кани пак (+{0}%, пази курса {1} ч).', Math.round(LETTERS.requestBonus * 100), LETTERS.requestHours)} />
      {letters.some((l) => !l.readAt) && <MarkLettersRead />}
      <Card>
        {!letters.length ? <Empty icon={Mail} title={t('Още няма писма')}>{t('Доставяй навреме — клиентите пишат на добрите шофьори.')}<EmptyAction href="/game/contracts" label="Намери курс" /></Empty> : (
          <ul className="space-y-3" data-testid="letters">
            {letters.map((l) => (
              <li key={l.id} className={`rounded-xl border p-3 text-sm ${l.readAt ? 'border-asphalt-800' : 'border-cyan-glow/50 bg-cyan-glow/5'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{l.title}</span>
                  <span className="text-xs text-mist-400">{dateTime(l.createdAt)}</span>
                </div>
                <p className="mt-1.5 text-mist-300">{l.body}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {l.kind === 'thanks' && <Badge tone="green">{t('Бонус {0}', money(l.bonusCents))}</Badge>}
                  {l.kind === 'complaint' && <Badge tone="red">{t('Оплакване')}</Badge>}
                  {l.kind === 'request' && (l.open ? <Link href="/game/contracts" className="btn-primary px-3 py-1.5 text-xs">{t('Към запазения курс')}</Link> : <Badge tone="neutral">{t('Курсът вече не е свободен')}</Badge>)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

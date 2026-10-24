import { Swords } from 'lucide-react';
import { notFound } from 'next/navigation';
import { DuelAnswer } from '@/components/game/TogetherActions';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { dateTime, dec } from '@/lib/format';
import { DUEL } from '@/lib/game/together';
import { gameContext } from '@/server/game/context';
import { duelsOf } from '@/server/game/together';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Дуели') };
}

export default async function DuelsPage() {
  await initLocale();
  const { db, user, features } = await gameContext();
  if (!features.duels) notFound();
  const list = await duelsOf(db, user.id, 20);
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('Дуели')}
        subtitle={t('1 срещу 1: кой ще превози повече тонове за {0} дни.', DUEL.days)}
        help={t('Предизвикай играч от картата му („Дуел“) или в Discord с /дуел. Той има {0} часа да приеме. От приемането се броят тоновете на доставките ви (по времето на пристигане) за {1} дни. Победителят получава {2} ТрансКоин и значката „Дуелист“. До {3} дуела наведнъж.', DUEL.pendingHours, DUEL.days, DUEL.coins, DUEL.maxOpen)}
      />
      <Card>
        {list.length === 0 ? (
          <Empty icon={Swords} title={t('Още нямаш дуели')}>{t('Отвори картата на играч (класации, чат, приятели) и натисни „Дуел“.')}</Empty>
        ) : (
          <ul className="divide-y divide-asphalt-800">
            {list.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 font-semibold">
                    <Swords className="h-4 w-4 text-loss" />{t('срещу {0}', d.rival)}
                    {d.status === 'active' && <Badge tone="cyan">{t('тече')}</Badge>}
                    {d.status === 'pending' && <Badge tone="gold">{d.incoming ? t('покана за теб') : t('чака отговор')}</Badge>}
                    {d.status === 'done' && <Badge tone={d.won === true ? 'green' : d.won === false ? 'red' : 'neutral'}>{d.won === true ? t('победа · +{0} TC', DUEL.coins) : d.won === false ? t('загуба') : t('равенство')}</Badge>}
                    {(d.status === 'declined' || d.status === 'expired') && <Badge tone="neutral">{d.status === 'declined' ? t('отказан') : t('изтекъл')}</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-mist-400">
                    {d.status === 'active' || d.status === 'done' ? <>{t('Ти')}{' '}<span className="num text-white">{t('{0} т', dec(d.myTons))}</span> : <span className="num text-white">{t('{0} т', dec(d.theirTons))}</span> {tx(d.rival)}{d.endsAt && d.status === 'active' ? t(' · край {0}', dateTime(d.endsAt)) : ''}</> : t('Изпратена {0}', dateTime(d.createdAt))}
                  </div>
                </div>
                {d.incoming && <DuelAnswer duelId={d.id} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
